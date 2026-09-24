import { json } from "@/lib/http";
import { runCampaignSweep } from "@/lib/campaign-sweep-run";
import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/campaign-cron";

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
 * ── WHAT STANDS BETWEEN THIS ROUTE AND A REAL PERSON ──
 *
 * Three gates, all of which must be opened deliberately:
 * `authorizeCronRequest` fails closed without `CRON_SECRET`; the sweep returns
 * 503 without `CAMPAIGN_FROM_ADDRESS`, which has no fallback to the
 * transactional sender; and `createCampaignDeliverer()` returns the LOG
 * deliverer unless `CAMPAIGN_DELIVERY_MODE` names a provider.
 *
 * As of 11 Sep 2026 all three ARE open in production, on
 * `CAMPAIGN_DELIVERY_MODE=resend`. Read this route as live. What remains
 * unfinished from docs/NEWSLETTER.md §2 and §7 is per-workspace send pacing;
 * campaign bounces and complaints reach suppressions through the Resend
 * webhook (lib/campaign-feedback.ts), and the provider's own team-wide
 * rate limit is respected by the Resend deliverer, which paces itself.
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
  /*
    The loop itself is lib/campaign-sweep-run.ts, shared with "Send now".

    It used to live here and nowhere else, which is why arming a campaign for
    "now" meant waiting up to an hour for the next tick. One copy, two callers:
    a second loop in the schedule route would have to repeat claim-before-send,
    per-campaign settling and the try/catch that stops one tenant's bad row
    abandoning another's send — and would eventually stop repeating one of them.
  */
  const run = await runCampaignSweep();
  if (!run.ok) {
    console.error(`[cron/campaigns] ${run.detail}`);
    return json(
      {
        error:
          run.reason === "not_configured"
            ? "Campaign sending not configured."
            : "Delivery misconfigured.",
      },
      { status: 503 },
    );
  }

  // Counts only — never addresses. This response goes into the sweep's log,
  // which is a different audience from the tenant whose subscribers these are.
  return json({ ok: true, ...run.summary });
}
