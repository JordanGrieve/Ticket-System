/**
 * The transactional provider's DAILY ceiling, and how close we are to it.
 *
 * Pure: no database, no clock of its own. lib/email-quota-store.ts is the IO
 * half.
 *
 * ── WHY THIS EXISTS ──
 * Every transactional email Postbox sends — ticket acknowledgements,
 * auto-replies, welcome emails, signup confirmations, agent replies, test
 * sends — leaves through one Resend account shared by every tenant. Resend's
 * free plan allows 3,000 a month and caps it at 100 a DAY, and PRICING.md
 * spells out how that ends: "the daily cap breaks first, and it breaks
 * silently for the client."
 *
 * Silently is the operative word. A refused send is a console.error and a
 * `{ sent: false }` most callers do not surface, so what a client actually
 * experiences is an acknowledgement that never arrives, with nothing anywhere
 * saying why. This module is what lets the daily health check say it out loud
 * the morning before it bites rather than the week after.
 *
 * ── IT COUNTS, IT DOES NOT BLOCK ──
 * Nothing here refuses a send. lib/trial.ts argues it at length and is right:
 * the person who suffers from a dropped enquiry is the CUSTOMER, who has no
 * idea a billing relationship exists. Reaching the cap is our problem to fix,
 * not theirs to absorb, so we count, warn, and let every send through until
 * the provider itself refuses it.
 */

/**
 * Resend's free-plan daily ceiling.
 *
 * Change this the day the plan changes — Pro is 50,000 a month with no daily
 * cap, at which point the honest value is the monthly one divided by the days
 * in a month, or this check retires. It is a constant rather than an env var
 * because it is a fact about a contract, and a fact that only one person can
 * change should not be silently overridable by a deploy.
 */
export const PROVIDER_DAILY_CAP = 100;

/** Past this share of the cap, the health check says something. */
export const WARN_AT = 0.8;

/**
 * The bucket key for one UTC day.
 *
 * A calendar day rather than a rolling 24 hours, because that is what the
 * provider counts. A rolling window opened by the day's first send would
 * drift from Resend's own boundary and report a number that is never quite
 * the number they are enforcing.
 *
 * UTC for the same reason lib/usage.ts uses it: a boundary that moves per
 * tenant is a boundary nobody can reconcile against a provider's dashboard.
 */
export function providerDayBucket(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `email:provider:${y}-${m}-${d}`;
}

export type QuotaState = {
  used: number;
  cap: number;
  /** Never negative: the provider can refuse past the cap, we still count. */
  remaining: number;
  /** At or past WARN_AT of the cap. */
  warn: boolean;
  /** Nothing left. The next send is the provider's to refuse, not ours. */
  exhausted: boolean;
};

export function quotaState(used: number, cap = PROVIDER_DAILY_CAP): QuotaState {
  const remaining = Math.max(0, cap - used);
  return {
    used,
    cap,
    remaining,
    // `used >= cap * WARN_AT` and not `remaining <= cap * (1 - WARN_AT)`:
    // they agree until the cap is zero, where the first is honest (warn
    // immediately) and the second divides a meaning out of nothing.
    warn: cap <= 0 || used >= cap * WARN_AT,
    exhausted: remaining === 0,
  };
}

/**
 * Whether a provider error is the cap being hit rather than a bad address.
 *
 * The two need telling apart because they mean opposite things: a rejected
 * recipient is one customer's problem and is often permanent, while a rate
 * limit is OUR problem, affects everybody, and clears on its own. Reported as
 * the same "send failed" they are indistinguishable in a log.
 *
 * Matched on the status code first — 429 is unambiguous — and on the wording
 * only as a fallback, because provider error names are not a contract and
 * this must not start lying the day one is renamed. A false negative here
 * costs a less specific log line; a false positive would claim the account is
 * capped when an address was simply wrong.
 */
export function isProviderRateLimit(err: {
  // `number | null` and not `number | undefined`: Resend's ErrorResponse
  // types it that way, and narrowing it here would mean every call site
  // casting the provider's own error object to get past the compiler.
  statusCode?: number | null;
  name?: string | null;
  message?: string | null;
}): boolean {
  if (err.statusCode === 429) return true;
  const text = `${err.name ?? ""} ${err.message ?? ""}`.toLowerCase();
  return (
    text.includes("rate limit") ||
    text.includes("rate_limit") ||
    text.includes("too many requests") ||
    text.includes("daily quota") ||
    text.includes("quota exceeded")
  );
}
