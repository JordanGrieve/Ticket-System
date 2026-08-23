import { json } from "@/lib/http";
import { sweepAutoReplyQueue } from "@/lib/auto-reply-send";
import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/campaign-cron";

/**
 * GET /api/cron/auto-replies — the deferred acknowledgement sweep.
 *
 * ── WHAT IT IS FOR ──
 *
 * A workspace on "During business hours only" used to have its
 * acknowledgements DROPPED outside those hours: the guard chain returned
 * `schedule` and nothing ever revisited the enquiry. A customer emailing at
 * 21:00 received the acknowledgement the client had configured and switched
 * on — never — and neither of them was told. Those enquiries are now held in
 * `auto_reply_queue` with a due time of the next opening minute, and this
 * endpoint is what wakes up and sends them.
 *
 * ── AUTHENTICATION ──
 *
 * `Authorization: Bearer $CRON_SECRET`, verified by the same timing-safe check
 * the campaign sweep uses, which FAILS CLOSED when the secret is unset.
 * proxy.ts lists `/api/(.*)` as public, so Clerk does not guard this path and
 * nothing else would: unauthenticated, this URL is a public "mail every
 * customer whose acknowledgement is waiting" button.
 *
 * The check is deliberately shared with the campaign sweep rather than copied.
 * Its log lines say `[cron/campaigns]`, which is inherited wording — the
 * refusal is re-logged below with this route's own prefix so a 401 here is not
 * mistaken for one there.
 *
 * The driver is .github/workflows/auto-reply-sweep.yml, NOT Vercel Cron: the
 * Hobby plan accepts only daily expressions, and an acknowledgement that
 * arrives once a day is not an acknowledgement.
 *
 * ── SAFE TO RUN LATE, EARLY, OR TWICE ──
 *
 * The claim UPDATE latches each row `pending → sending`, so overlapping ticks
 * cannot both send the same one; a tick that arrives before the window opens
 * finds the schedule still closed and re-plans the row instead of sending; and
 * a row whose due time is more than twelve hours stale is dropped rather than
 * delivered, so a sweep that was dead for two days does not mail out a pile of
 * obsolete acknowledgements when it comes back.
 */

// Node, not edge: the auth check uses node:crypto and the sweep uses the
// database and mail provider.
export const runtime = "nodejs";
// Reads headers, and a cached send trigger is not a thing worth leaving to
// inference.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = authorizeCronRequest(
    req.headers.get("authorization"),
    process.env[CRON_SECRET_ENV],
  );
  if (!auth.ok) {
    console.error(`[cron/auto-replies] ${auth.log}`);
    return json({ error: auth.error }, { status: auth.status });
  }

  const startedAt = Date.now();
  const summary = await sweepAutoReplyQueue();

  console.info(
    `[cron/auto-replies] ${summary.claimed} claimed, ${summary.sent} sent, ` +
      `${summary.suppressed} suppressed, ${summary.requeued} requeued, ` +
      `${summary.failed} failed, ${summary.errored} errored, ` +
      `${Date.now() - startedAt}ms`,
  );

  // Counts only, never addresses: this response lands in a public repository's
  // Actions log.
  return json({ ok: true, ...summary });
}
