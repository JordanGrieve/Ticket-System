import { planById, TRIAL_LIMITS, type PlanId } from "./pricing";

/**
 * What a workspace has used, and what it is allowed.
 *
 * Pure: no database, no clock of its own — `now` is always passed in.
 * lib/usage-store.ts is the IO half. Every rule that could be wrong lives
 * here, because each of them decides whether a paying customer can do
 * something they are paying for.
 *
 * ── WHY THIS EXISTS ──
 * Until 11 September 2026 the product enforced exactly two limits: seats on
 * invite, and newsletter sending during a trial. `ticketsPerMonth` was never
 * counted anywhere, the subscriber cap was only ever read as a yes/no "does
 * this plan include newsletters", and there was no counter for emails at all
 * — the one thing that appears on a bill we pay. See PRICING.md.
 */

/**
 * The things worth counting.
 *
 * `emails_sent` is every email leaving on a workspace's behalf: auto-replies,
 * ticket notifications, agent replies, signup confirmations, the welcome, and
 * campaign recipients. Counting only the marketing half would be a limit on
 * the cheaper half.
 *
 * `tickets_opened` is metered but never enforced — see `enforcement` below.
 */
export const USAGE_METRICS = ["emails_sent", "tickets_opened"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

/**
 * The calendar month a moment falls in, as "2026-09".
 *
 * UTC, deliberately. A workspace's own timezone would make the boundary move
 * per tenant, so two workspaces could disagree about which month an email
 * belonged to, and a counter that resets at a different instant from the one
 * that reads it is a counter nobody can reconcile against an invoice.
 */
export function periodKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * How a limit is treated when it is reached.
 *
 * ── THE RULE THIS FOLLOWS, AND WHY ──
 * lib/trial.ts already argues it at length and it is right: an expired trial
 * or a failed card must never cost a business their customers' enquiries. The
 * person who suffers from a dropped enquiry is the CUSTOMER, who has no idea
 * a billing relationship exists and no way to fix it.
 *
 * So sending is blocked and receiving never is. `tickets_opened` is metered
 * so an overage is a conversation somebody can have with evidence, not a wall
 * a customer walks into.
 */
export type Enforcement = "blocks_sending" | "metered_only";

export const ENFORCEMENT: Record<UsageMetric, Enforcement> = {
  emails_sent: "blocks_sending",
  tickets_opened: "metered_only",
};

/** The monthly email allowance for a plan state, or null when uncapped. */
export function emailAllowance(plan: PlanId | "trial"): number {
  if (plan === "trial") return TRIAL_LIMITS.emails;
  return planById(plan)?.limits.emailsPerMonth ?? 0;
}

export type AllowanceCheck = {
  /** How many more may be sent right now. Never negative. */
  remaining: number;
  /** Nothing left. */
  exhausted: boolean;
  /** Past 80% — worth telling the account holder before it bites. */
  warn: boolean;
};

/**
 * What is left of this month's email allowance.
 *
 * `used` may legitimately EXCEED the allowance: a batch is budgeted before it
 * is claimed, and a campaign already in flight when a plan is downgraded will
 * have spent more than the new plan permits. Clamping at zero is what makes
 * that state safe to render rather than a negative number on a settings page.
 */
export function checkAllowance(used: number, allowance: number): AllowanceCheck {
  const remaining = Math.max(0, allowance - used);
  return {
    remaining,
    exhausted: remaining === 0,
    // 80% of nothing is nothing, so an allowance of zero warns immediately
    // rather than dividing by it.
    warn: allowance <= 0 || used >= allowance * 0.8,
  };
}

/**
 * How many of `wanted` may actually be sent.
 *
 * The send loop asks this before claiming a batch. Partial is the correct
 * answer rather than all-or-nothing: a campaign of five hundred against
 * eighty remaining should send eighty and stop, not refuse entirely and not
 * send five hundred. The rest stay queued for next month, or for the upgrade.
 */
export function budgetFor(wanted: number, used: number, allowance: number): number {
  return Math.max(0, Math.min(wanted, allowance - used));
}
