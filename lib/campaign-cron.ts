import { createHash, timingSafeEqual } from "crypto";
import type { SendBatchResult } from "./campaign-send";

/**
 * Scheduled-sweep POLICY. Pure decisions only — no database, no `lib/config`,
 * no provider, no `process.env`.
 *
 * The split mirrors lib/newsletter.ts / lib/campaign-send.ts and exists for the
 * same reason: `db/index.ts` throws at import time when DATABASE_URL is unset,
 * and the test suite runs without one. Everything in this file is therefore
 * importable by a test, which is the only way the authorisation check and the
 * batch arithmetic below get asserted on rather than merely reasoned about.
 *
 * The IO half lives in two places, both deliberately:
 *   • lib/campaign-send.ts — claimDueCampaigns / settleCampaign, because that
 *     is already the module that owns campaign reads and writes and their
 *     tenancy discipline;
 *   • app/api/cron/campaigns/route.ts — the wiring, the env, the deliverer.
 */

// ── Authorisation ────────────────────────────────────────────────

/**
 * The shared secret the scheduled sweep authenticates with. The caller sends
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * The value must exist in TWO places, byte-identical:
 *   • a GitHub Actions repository secret named CRON_SECRET, read by
 *     .github/workflows/campaign-sweep.yml;
 *   • a Vercel environment variable named CRON_SECRET on the project.
 * If they drift, every tick 401s — which is why the workflow fails loudly on
 * any non-2xx rather than logging a green tick over a rejected request.
 */
export const CRON_SECRET_ENV = "CRON_SECRET";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string; log: string };

/**
 * Decide whether a request may run the sweep.
 *
 * ── THIS FAILS CLOSED, AND THAT IS THE ENTIRE POINT ──
 *
 * The obvious shape of this function is:
 *
 *     if (secret && header !== `Bearer ${secret}`) return unauthorized;
 *
 * which runs the sweep for ANYONE when the secret is not configured. That is
 * exactly the bug app/api/inbound/route.ts had — `if (signingSecret ||
 * sharedEnabled)` — where a missing secret silently disabled the check and left
 * the webhook world-writable. It shipped, it built cleanly, and nothing logged.
 *
 * The stakes here are higher than they were there. This endpoint's job is to
 * take mail out of the queue and hand it to a provider. An unauthenticated
 * version of it is a public "send my customers' marketing email now" button
 * that anyone who can guess a URL may press, repeatedly, from anywhere. So a
 * missing `CRON_SECRET` is treated as a deployment fault (503) and refuses
 * every caller, including Vercel, until it is set.
 *
 * The comparison is over SHA-256 digests rather than the raw strings: digests
 * are fixed width, so `timingSafeEqual` cannot throw on a length mismatch and
 * the check leaks neither the secret's content nor its length.
 */
export function authorizeCronRequest(
  authorizationHeader: string | null,
  secret: string | undefined,
): CronAuthResult {
  const configured = (secret ?? "").trim();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "Campaign sweep not configured.",
      log:
        `[cron/campaigns] ${CRON_SECRET_ENV} is not set. Refusing every ` +
        `invocation rather than running unauthenticated — this endpoint sends ` +
        `email, so an open version of it is a public send trigger.`,
    };
  }

  const presented = (authorizationHeader ?? "").trim();
  if (!presented || !constantTimeEquals(presented, `Bearer ${configured}`)) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
      log: "[cron/campaigns] rejected an invocation with a missing or wrong bearer token.",
    };
  }

  return { ok: true };
}

function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

// ── Batch sizing ─────────────────────────────────────────────────

/**
 * How long the function is allowed to run, in milliseconds. Must match the
 * `maxDuration` exported by app/api/cron/campaigns/route.ts — it is duplicated
 * because that export must be a literal Next.js can read statically.
 *
 * 60s is the ceiling the current plan gives us. On Pro with Fluid compute this
 * can go to 300, and RECIPIENTS_PER_SWEEP below scales with it linearly.
 */
export const FUNCTION_BUDGET_MS = 60_000;

/**
 * The point after which no NEW campaign batch is started.
 *
 * Checked BETWEEN campaigns, not between recipients: the per-row loop lives
 * inside `sendCampaignBatch` and must not be interrupted part-way, because the
 * claim-before-send protocol has already marked a row `sent` by the time the
 * provider call is in flight. Killing the invocation mid-row loses that one
 * email; killing it between campaigns loses nothing at all.
 *
 * Consequence: one whole campaign batch has to fit in the remaining budget,
 * which is what forces RECIPIENTS_PER_SWEEP to be small.
 */
export const SWEEP_DEADLINE_MS = 45_000;

/**
 * Rows attempted per invocation, across every campaign.
 *
 * ── THE ARITHMETIC ──
 *
 *  Function budget                                          60,000 ms
 *  − cold start, due-campaign query, settle statements       ~6,000 ms
 *  − the tail of one provider call already in flight         ~2,000 ms
 *  ────────────────────────────────────────────────────────────────
 *  Usable send window (SWEEP_DEADLINE_MS)                    45,000 ms
 *
 *  Cost of one recipient inside sendCampaignBatch:
 *    claim UPDATE ................ 1 round trip  ~40 ms   (Neon serverless
 *    result/failure UPDATE ....... 1 round trip  ~40 ms    HTTP, lhr1, in-region)
 *    provider call ............... SES SendRawEmail p95 ~200 ms
 *    render ...................... negligible, in-process
 *                                              ─────────
 *                                               ~280 ms → round to 300 ms
 *
 *  45,000 / 300 = 150 recipients.
 *  Halved for p99 latency, a slow suppression sweep, and a cold pool → 75.
 *
 * Sanity-check against the provider, not just the clock: 75 messages over 45s
 * is ~1.7/s. That is inside SES' lowest default quota (14/s) and inside
 * Resend's 10 rps — which matters because that limit is shared team-wide with
 * ticket replies, and a campaign that saturates it is a support-mail outage for
 * every tenant (docs/NEWSLETTER.md §1.5).
 *
 * ── WHAT THIS COSTS IN THROUGHPUT ──
 *
 * 75 is per INVOCATION, not per minute. The 60-second budget above sizes ONE
 * run; the CADENCE is what turns it into a throughput, and the cadence no
 * longer comes from Vercel. Vercel's Hobby plan fails the deployment on a
 * sub-daily cron expression, which pinned this sweep at `0 3 * * *` — once a
 * day, i.e. 75 recipients per DAY, i.e. ~534 days for a 40,000-recipient
 * campaign. It is now driven by .github/workflows/campaign-sweep.yml on a
 * five-minute step: 288 sweeps a day → 21,600 recipients/day, and the same
 * campaign drains in about two days.
 *
 * Raising THIS constant still does not buy throughput — its ceiling is the 60s
 * function budget, not the number. On Vercel Pro, `maxDuration` can go to 300
 * with Fluid compute, which would take it to ~450 on the same margins.
 *
 * GitHub's schedule is best effort: ticks are delayed under runner load,
 * dropped outright with no backfill, and the workflow is auto-disabled after
 * 60 days without a commit. So 288 is a ceiling. Anything in the product that
 * quotes a completion time must compute it from SWEEPS_PER_DAY in
 * lib/campaign-schedule.ts and read as a floor on elapsed time.
 */
export const RECIPIENTS_PER_SWEEP = 75;

/**
 * How many campaigns one invocation will touch.
 *
 * More than one so a single large campaign cannot starve every other tenant's;
 * bounded so the fixed per-campaign overhead (the campaign read and the
 * suppression retirement sweep, both once per campaign) does not eat the
 * budget. Combined with the round-robin ordering in `claimDueCampaigns`, three
 * per tick is enough to keep concurrent campaigns all making progress.
 */
export const MAX_CAMPAIGNS_PER_SWEEP = 3;

export type SweepPlan = {
  /** Campaigns to ask the database for. */
  campaignLimit: number;
  /** `limit` to hand each `sendCampaignBatch` call. */
  recipientsPerCampaign: number;
};

/**
 * Split the row budget across the campaigns that are actually due.
 *
 * One due campaign gets the whole budget; three get a third each. The budget is
 * global rather than per-campaign because the thing being rationed is the
 * function's wall clock, and that does not grow when a second tenant starts a
 * campaign.
 *
 * Never returns less than 1: a plan of 0 would read zero rows forever and the
 * campaign would sit `sending` indefinitely with no error anywhere.
 */
export function planSweep(dueCampaignCount: number): SweepPlan {
  const campaigns = Math.max(
    1,
    Math.min(dueCampaignCount, MAX_CAMPAIGNS_PER_SWEEP),
  );
  return {
    campaignLimit: MAX_CAMPAIGNS_PER_SWEEP,
    recipientsPerCampaign: Math.max(
      1,
      Math.floor(RECIPIENTS_PER_SWEEP / campaigns),
    ),
  };
}

/** True once there is no longer time to start another campaign's batch. */
export function sweepDeadlineReached(
  startedAtMs: number,
  nowMs: number,
  deadlineMs: number = SWEEP_DEADLINE_MS,
): boolean {
  return nowMs - startedAtMs >= deadlineMs;
}

// ── Reporting ────────────────────────────────────────────────────

export type SweepCampaignOutcome = {
  campaignId: number;
  workspaceId: number;
  /** Null when the batch threw before producing a result. */
  result: SendBatchResult | null;
  /** Present when the batch threw. The message only — never the stack. */
  error?: string;
  /** True when this batch drained the campaign and it moved to `sent`. */
  completed: boolean;
};

export type SweepSummary = {
  campaigns: number;
  claimed: number;
  delivered: number;
  failed: number;
  suppressed: number;
  completed: number;
  errored: number;
  /** True when at least one campaign still has queued rows. */
  more: boolean;
};

/**
 * Fold the per-campaign outcomes into the numbers the cron log shows.
 *
 * A campaign that threw contributes to `errored` and to nothing else. It
 * deliberately does NOT contribute to `failed`: `failed` counts recipients the
 * provider rejected, and conflating "the provider said no to this address" with
 * "the sweep fell over" makes the campaign report lie about deliverability.
 */
export function summariseSweep(
  outcomes: readonly SweepCampaignOutcome[],
): SweepSummary {
  const summary: SweepSummary = {
    campaigns: outcomes.length,
    claimed: 0,
    delivered: 0,
    failed: 0,
    suppressed: 0,
    completed: 0,
    errored: 0,
    more: false,
  };

  for (const outcome of outcomes) {
    if (outcome.completed) summary.completed += 1;
    if (!outcome.result) {
      summary.errored += 1;
      // A campaign that threw may well still have queued rows. Reporting
      // `more: false` here would tell the next tick there is nothing to do.
      summary.more = true;
      continue;
    }
    summary.claimed += outcome.result.claimed;
    summary.delivered += outcome.result.delivered;
    summary.failed += outcome.result.failed;
    summary.suppressed += outcome.result.suppressed;
    if (outcome.result.more) summary.more = true;
  }

  return summary;
}

// ── Envelope configuration ───────────────────────────────────────

export type SendEnvelope = {
  /** Envelope sender. On the MARKETING domain — never replies@. */
  from: string;
  /** Monitored mailto for List-Unsubscribe, or null to omit the entry. */
  unsubscribeMailto: string | null;
};

export type EnvelopeResult =
  | { ok: true; envelope: SendEnvelope }
  | { ok: false; error: string };

export const CAMPAIGN_FROM_ENV = "CAMPAIGN_FROM_ADDRESS";
export const CAMPAIGN_UNSUBSCRIBE_MAILTO_ENV = "CAMPAIGN_UNSUBSCRIBE_MAILTO";

/**
 * Read the envelope out of the environment, refusing rather than guessing.
 *
 * There is no fallback to `EMAIL_FROM_ADDRESS`, and that omission is the point.
 * That address is `replies@postbox.help` — the TRANSACTIONAL sender on our
 * primary domain. Sending bulk marketing from it is precisely the mistake
 * docs/NEWSLETTER.md §1.3 spends a section on: it pushes the primary domain
 * over Gmail's 5,000/day bulk-sender threshold permanently, and every marketing
 * complaint then lands on the reputation carrying every tenant's ticket
 * replies. A defaulted value here would make that happen quietly, on the first
 * send, with nobody having decided it.
 *
 * The mailto is optional and stays null when unset — a List-Unsubscribe
 * pointing at an unmonitored inbox is worse than no header at all (§5).
 */
export function envelopeFromEnv(
  env: Record<string, string | undefined>,
): EnvelopeResult {
  const from = (env[CAMPAIGN_FROM_ENV] ?? "").trim();
  if (!from) {
    return {
      ok: false,
      error:
        `${CAMPAIGN_FROM_ENV} is not set. It must be an address on the ` +
        `MARKETING sending domain; there is deliberately no fallback to the ` +
        `transactional sender.`,
    };
  }
  const mailto = (env[CAMPAIGN_UNSUBSCRIBE_MAILTO_ENV] ?? "").trim();
  return { ok: true, envelope: { from, unsubscribeMailto: mailto || null } };
}
