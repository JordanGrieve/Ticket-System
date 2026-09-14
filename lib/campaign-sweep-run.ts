import "server-only";
import {
  claimDueCampaigns,
  sendCampaignBatch,
  settleCampaign,
} from "./campaign-send";
import {
  envelopeFromEnv,
  planSweep,
  summariseSweep,
  sweepDeadlineReached,
  type SweepCampaignOutcome,
  type SweepSummary,
} from "./campaign-cron";
import { createCampaignDeliverer } from "./deliver";
import { recordTransactionalSend } from "./email-quota-store";
import { APP_URL } from "./config";

/**
 * One pass of the send loop, shared by the scheduled sweep and by "Send now".
 *
 * ── WHY IT IS SHARED ──
 * This was the body of app/api/cron/campaigns/route.ts and nothing else could
 * reach it, so a campaign armed for "now" waited up to an hour for the next
 * tick — 0 to 59 minutes of nothing, for three emails. Jordan, 14 Sep 2026:
 * "so wait, when I send it out, it's not straight away, but a set time?"
 *
 * The fix that suggests itself is a faster cron, and it is the wrong one: each
 * tick wakes the Neon compute for the autosuspend window whether or not there
 * is anything to do, and five-minute sweeps run at roughly 180 CU-hours
 * against a 100-hour allowance. Neon Free does not bill that overage, it
 * SUSPENDS the compute — so the failure mode of a chattier cron is the whole
 * product going down. Sending inside the request that armed the campaign adds
 * no scheduled wakes at all: the database is already awake, because somebody
 * just pressed a button.
 *
 * ── AND WHY IT IS ONE COPY ──
 * The obvious alternative was a second, smaller loop in the schedule route.
 * Everything careful here would then exist twice: claiming before sending,
 * settling per campaign, the per-campaign try/catch that stops one tenant's
 * bad row abandoning another's send, the deadline check placed BETWEEN
 * campaigns rather than inside the row loop. Two copies of that is how one of
 * them quietly stops settling, or starts sending twice.
 */

export type SweepRunResult =
  | { ok: true; summary: SweepSummary }
  | { ok: false; reason: "not_configured" | "misconfigured"; detail: string };

export async function runCampaignSweep(options?: {
  /**
   * Restrict to one campaign. "Send now" passes the campaign it just armed;
   * the cron passes nothing and takes whatever is due.
   */
  onlyCampaignId?: number;
  /**
   * How long this pass may spend before stopping between campaigns. The cron
   * gets the full budget; an interactive send gets less, because a button that
   * holds a request open for forty-five seconds reads as broken.
   */
  deadlineMs?: number;
}): Promise<SweepRunResult> {
  // Envelope before anything else. No `CAMPAIGN_FROM_ADDRESS` means no send —
  // there is deliberately no fallback to replies@, which is the transactional
  // sender on the primary domain.
  const envelope = envelopeFromEnv(process.env);
  if (!envelope.ok) {
    return { ok: false, reason: "not_configured", detail: envelope.error };
  }

  /*
    Log-only unless CAMPAIGN_DELIVERY_MODE is `resend`. Constructed ONCE per
    pass and reused for every recipient, which is what lets the Resend
    deliverer pace itself across the whole run rather than per row — a new one
    each time would reset the pacer and burst straight through the team-wide
    rate limit. It THROWS if the mode names a provider that is not configured
    rather than quietly degrading to the log deliverer.
  */
  let deliver;
  try {
    // Campaign recipients leave through the same Resend allowance as ticket
    // acknowledgements, so they are counted the same way.
    deliver = createCampaignDeliverer({ onSent: recordTransactionalSend });
  } catch (err) {
    return {
      ok: false,
      reason: "misconfigured",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const startedAt = Date.now();
  const plan = planSweep(0);
  const due = await claimDueCampaigns(
    plan.campaignLimit,
    options?.onlyCampaignId,
  );
  if (due.length === 0) {
    return { ok: true, summary: summariseSweep([]) };
  }

  // Re-plan now the real count is known: one due campaign gets the whole row
  // budget, three get a third each.
  const { recipientsPerCampaign } = planSweep(due.length);

  const outcomes: SweepCampaignOutcome[] = [];
  for (const campaign of due) {
    /*
      Checked between campaigns only. The per-recipient loop inside
      sendCampaignBatch must not be cut short: claim-before-send has already
      marked a row `sent` while its provider call is in flight, so being killed
      mid-row loses that email. Being killed here loses nothing — the next tick
      picks the campaign up exactly where it was.
    */
    if (sweepDeadlineReached(startedAt, Date.now(), options?.deadlineMs)) break;

    try {
      const result = await sendCampaignBatch({
        workspaceId: campaign.workspaceId,
        campaignId: campaign.id,
        limit: recipientsPerCampaign,
        deliver,
        from: envelope.envelope.from,
        workspaceName: campaign.workspaceName,
        // Passed in, never read from lib/config inside the send loop — that
        // module must stay safe to reach from a client component.
        appUrl: APP_URL,
        unsubscribeMailto: envelope.envelope.unsubscribeMailto,
        sender: {
          workspaceName: campaign.workspaceName,
          legalName: campaign.legalName,
          postalAddress: campaign.postalAddress,
        },
        // Carried on the claimed row alongside the identity, so a campaign
        // renders with the branding its own workspace chose even when this
        // pass is working through several workspaces.
        brand: {
          accentHex: campaign.brandAccentHex,
          signOff: campaign.brandSignOff,
        },
      });
      const settled = await settleCampaign(campaign.workspaceId, campaign.id);
      outcomes.push({
        campaignId: campaign.id,
        workspaceId: campaign.workspaceId,
        result,
        completed: settled.completed,
      });
    } catch (err) {
      /*
        One campaign throwing must not abandon the others: they belong to
        different tenants and a bad row in one workspace is not a reason to
        stop another workspace's send.

        Nothing is rolled back and nothing needs to be. Every recipient row was
        already settled individually inside sendCampaignBatch — claimed rows
        are `sent`, provider rejections are `failed` with their error text.
        Rows this batch never reached are untouched and still `queued`, so the
        next pass retries exactly those.

        The campaign is NOT marked failed. It keeps its queued rows and gets
        picked up again; a transient database blip must not permanently strand
        a half-sent campaign.
      */
      console.error(
        `[sweep] campaign ${campaign.id} (workspace ${campaign.workspaceId}) failed:`,
        err,
      );
      outcomes.push({
        campaignId: campaign.id,
        workspaceId: campaign.workspaceId,
        result: null,
        error: err instanceof Error ? err.message : String(err),
        completed: false,
      });
    }
  }

  const summary = summariseSweep(outcomes);
  console.info(
    `[sweep] ${summary.campaigns} campaign(s), ${summary.claimed} claimed, ` +
      `${summary.delivered} delivered, ${summary.failed} failed, ` +
      `${summary.suppressed} suppressed, ${summary.completed} completed, ` +
      `${summary.errored} errored, more=${summary.more}, ` +
      `${Date.now() - startedAt}ms`,
  );

  return { ok: true, summary };
}
