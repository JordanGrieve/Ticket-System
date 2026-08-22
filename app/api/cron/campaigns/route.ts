import { json } from "@/lib/http";
import { APP_URL } from "@/lib/config";
import { createCampaignDeliverer } from "@/lib/deliver";
import {
  claimDueCampaigns,
  sendCampaignBatch,
  settleCampaign,
} from "@/lib/campaign-send";
import {
  authorizeCronRequest,
  envelopeFromEnv,
  planSweep,
  summariseSweep,
  sweepDeadlineReached,
  CRON_SECRET_ENV,
  type SweepCampaignOutcome,
} from "@/lib/campaign-cron";

/**
 * GET /api/cron/campaigns — the scheduled campaign sweep.
 *
 * This is prerequisite 1 from docs/NEWSLETTER.md §2: the durable, resumable
 * worker. It claims a bounded batch of `queued` recipients for each campaign
 * that is due, hands each to the deliverer, and returns. There is no loop that
 * runs until the campaign is finished — the next tick continues.
 *
 * ── campaign_recipients IS the queue ──
 *
 * No jobs table was added and none is needed. `campaign_recipients` already
 * has every property a queue needs: a `queued → sent` claim latch enforced in
 * the UPDATE, a unique index on (campaign_id, subscriber_id) for idempotency,
 * an `attempts` counter, and an `error` column. Adding a second queue beside it
 * would mean two sources of truth about whether a person has been mailed, and
 * the failure mode of them disagreeing is mailing somebody twice.
 *
 * ── AUTHENTICATION ──
 *
 * The caller sends `Authorization: Bearer $CRON_SECRET`. `authorizeCronRequest`
 * verifies it with a timing-safe digest comparison and FAILS CLOSED when
 * `CRON_SECRET` is unset — see the long comment there. proxy.ts lists
 * `/api/(.*)` as public, so Clerk does not guard this path and nothing else
 * would: without that check this URL is a public "send everyone's marketing
 * email now" button.
 *
 * The caller is .github/workflows/campaign-sweep.yml, NOT Vercel Cron: the
 * Hobby plan rejects sub-daily cron expressions, and once a day makes this
 * sweep useless. The check is on the bearer token alone and deliberately not
 * on any Vercel-specific header, so the driver can be swapped again without
 * touching auth.
 *
 * ── WHY THIS STILL CANNOT MAIL A REAL PERSON ──
 *
 * `createCampaignDeliverer()` returns the LOG deliverer unless
 * `CAMPAIGN_DELIVERY_MODE=ses`, which is set in no environment; and the sweep
 * refuses to run at all without `CAMPAIGN_FROM_ADDRESS`, which has no fallback
 * to the transactional sender. Both must be set deliberately, and the
 * prerequisites listed in docs/NEWSLETTER.md §2 and §7 — a cross-invocation
 * rate limiter, the bounce/complaint webhook, a verified marketing domain, and
 * consent enforcement — are not finished.
 */

// Node, not edge: the deliverer and the auth check both use node:crypto.
export const runtime = "nodejs";
// Never prerender or cache this. It reads headers, so it would be treated as
// dynamic anyway, but a cached send trigger is not a thing worth leaving to
// inference.
export const dynamic = "force-dynamic";
// Keep in step with FUNCTION_BUDGET_MS in lib/campaign-cron.ts, which is what
// the batch sizing is derived from.
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = authorizeCronRequest(
    req.headers.get("authorization"),
    process.env[CRON_SECRET_ENV],
  );
  if (!auth.ok) {
    console.error(auth.log);
    return json({ error: auth.error }, { status: auth.status });
  }

  // Envelope before anything else. No `CAMPAIGN_FROM_ADDRESS` means no send —
  // there is deliberately no fallback to replies@, which is the transactional
  // sender on the primary domain (docs/NEWSLETTER.md §1.3).
  const envelope = envelopeFromEnv(process.env);
  if (!envelope.ok) {
    console.error(`[cron/campaigns] ${envelope.error}`);
    return json({ error: "Campaign sending not configured." }, { status: 503 });
  }

  // Log-only unless CAMPAIGN_DELIVERY_MODE=ses. Constructed once per
  // invocation, and it THROWS if the mode says ses but SES is unconfigured
  // rather than quietly degrading to the log deliverer — see lib/deliver.ts.
  let deliver;
  try {
    deliver = createCampaignDeliverer();
  } catch (err) {
    console.error("[cron/campaigns] deliverer refused to construct:", err);
    return json({ error: "Delivery misconfigured." }, { status: 503 });
  }

  const startedAt = Date.now();
  const plan = planSweep(0);
  const due = await claimDueCampaigns(plan.campaignLimit);
  if (due.length === 0) {
    return json({ ok: true, campaigns: 0, claimed: 0, more: false });
  }

  // Re-plan now the real count is known: one due campaign gets the whole row
  // budget, three get a third each.
  const { recipientsPerCampaign } = planSweep(due.length);

  const outcomes: SweepCampaignOutcome[] = [];
  for (const campaign of due) {
    // Checked between campaigns only. The per-recipient loop inside
    // sendCampaignBatch must not be cut short: claim-before-send has already
    // marked a row `sent` while its provider call is in flight, so being killed
    // mid-row loses that email. Being killed here loses nothing — the next tick
    // picks the campaign up exactly where it was.
    if (sweepDeadlineReached(startedAt, Date.now())) break;

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
      });
      const settled = await settleCampaign(campaign.workspaceId, campaign.id);
      outcomes.push({
        campaignId: campaign.id,
        workspaceId: campaign.workspaceId,
        result,
        completed: settled.completed,
      });
    } catch (err) {
      // One campaign throwing must not abandon the others: they belong to
      // different tenants and a bad row in one workspace is not a reason to
      // stop another workspace's send.
      //
      // Nothing is rolled back and nothing needs to be. Every recipient row was
      // already settled individually inside sendCampaignBatch — claimed rows
      // are `sent`, provider rejections are `failed` with their error text.
      // Rows this batch never reached are untouched and still `queued`, so the
      // next tick retries exactly those. The one loss window is unchanged from
      // the documented one: a crash between a row's claim UPDATE and its
      // provider call drops that single email rather than duplicating it.
      //
      // The campaign is NOT marked failed. It keeps its queued rows and gets
      // picked up again; a transient database blip must not permanently strand
      // a half-sent campaign.
      console.error(
        `[cron/campaigns] campaign ${campaign.id} (workspace ${campaign.workspaceId}) failed:`,
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
    `[cron/campaigns] ${summary.campaigns} campaign(s), ${summary.claimed} claimed, ` +
      `${summary.delivered} delivered, ${summary.failed} failed, ` +
      `${summary.suppressed} suppressed, ${summary.completed} completed, ` +
      `${summary.errored} errored, more=${summary.more}, ` +
      `${Date.now() - startedAt}ms`,
  );

  // Counts only — never addresses. This response goes into Vercel's cron log,
  // which is a different audience from the tenant whose subscribers these are.
  return json({ ok: true, ...summary });
}
