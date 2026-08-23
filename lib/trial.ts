import type { PlanState } from "@/db/schema";
import { TRIAL_DAYS, TRIAL_LIMITS, planById } from "./pricing";

/**
 * What a workspace is currently allowed to do, and why.
 *
 * Pure: no database, no Stripe, no clock of its own — `now` is always passed
 * in. Every rule here decides whether a paying customer can use something they
 * are paying for, so they are worth proving without a deployment.
 *
 * ── THE RULE THAT MATTERS MOST ──
 * An expired trial or a failed card must NEVER cost a business their
 * customers' enquiries. Inbound mail and form submissions keep being accepted
 * and recorded whatever the billing state. The person who suffers from a
 * dropped enquiry is the CUSTOMER, who has no idea a billing relationship
 * exists and no way to fix it — and the business loses a sale because of an
 * invoice they may not even have seen yet.
 *
 * What does stop is SENDING newsletters, because that costs real money and
 * real sending reputation, and the person it inconveniences is the account
 * holder, who can fix it. `mayReceive` and `maySendCampaigns` are separate
 * for exactly this reason, and no caller should ever collapse them.
 *
 * ── COMPED WORKSPACES ──
 * A paid plan with no Stripe subscription is comped: entitled to everything,
 * never expiring, nothing owed. That is how the pilot client and any workspace
 * predating billing are represented (see migration 0014), and how an operator
 * grants free access. It is a named state, not an accident of null-checking.
 */

export type Entitlement = {
  plan: PlanState;
  /** True while the workspace is on a trial that has not ended. */
  onTrial: boolean;
  /** Paid plan with no Stripe subscription — free forever, by decision. */
  comped: boolean;
  /**
   * Customer enquiries are accepted. ALWAYS TRUE. Present as a field so the
   * intent is visible at every call site rather than implied by absence.
   */
  mayReceive: true;
  /** Newsletters may be sent. */
  maySendCampaigns: boolean;
  /** Whole days left of the trial, floored at 0. Null when not on trial. */
  daysLeft: number | null;
  /** Why sending is blocked, for the UI. Null when it is not. */
  blockedReason: BlockedReason | null;
};

export type BlockedReason =
  | "trial_expired"
  | "trial_ticket_limit"
  | "trial_subscriber_limit"
  | "subscription_lapsed"
  | "plan_excludes_newsletters";

export type WorkspaceBilling = {
  plan: PlanState;
  trialStartedAt: Date;
  stripeSubscriptionId: string | null;
  /** End of the period actually paid for. Null when there is no subscription. */
  currentPeriodEnd: Date | null;
};

export type Usage = {
  /** Tickets opened this billing period. */
  tickets: number;
  /** Confirmed subscribers currently held. */
  subscribers: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a trial that started at `from` runs out. */
export function trialEndsAt(from: Date): Date {
  return new Date(from.getTime() + TRIAL_DAYS * DAY_MS);
}

export function entitlement(
  workspace: WorkspaceBilling,
  usage: Usage,
  now: Date,
): Entitlement {
  const base = {
    plan: workspace.plan,
    mayReceive: true as const,
  };

  if (workspace.plan === "trial") {
    const endsAt = trialEndsAt(workspace.trialStartedAt);
    const msLeft = endsAt.getTime() - now.getTime();
    // Floor at 0 rather than reporting negative days. Ceil, not floor, of the
    // remainder: with eight hours to go a person has "1 day left", not "0",
    // and telling them 0 while the thing still works reads as a bug.
    const daysLeft = msLeft <= 0 ? 0 : Math.ceil(msLeft / DAY_MS);

    // Order matters: report the limit that actually bit. "Your trial ended"
    // when they in fact hit the subscriber cap on day three sends somebody to
    // wait for a date that is not the problem.
    let blockedReason: BlockedReason | null = null;
    if (msLeft <= 0) blockedReason = "trial_expired";
    else if (usage.tickets >= TRIAL_LIMITS.tickets)
      blockedReason = "trial_ticket_limit";
    else if (usage.subscribers >= TRIAL_LIMITS.subscribers)
      blockedReason = "trial_subscriber_limit";

    return {
      ...base,
      onTrial: blockedReason === null,
      comped: false,
      maySendCampaigns: blockedReason === null,
      daysLeft,
      blockedReason,
    };
  }

  // A paid plan with no Stripe subscription is comped.
  const comped = workspace.stripeSubscriptionId === null;

  // Judged on the period PAID FOR, not on Stripe's status string. Stripe
  // retries a failed card for days; throughout that window the status is
  // past_due but the customer has paid for the current period and is entitled
  // to it. Cutting them off early takes something they bought.
  const paidThrough = workspace.currentPeriodEnd;
  const lapsed =
    !comped && (paidThrough === null || paidThrough.getTime() <= now.getTime());

  // Narrowed to the paid ids by the early return above, so no 'trial' fallback
  // is needed here — TypeScript rejects one as dead code, correctly.
  const plan = planById(workspace.plan);
  const planHasNewsletters = (plan?.limits.subscribers ?? 0) > 0;

  let blockedReason: BlockedReason | null = null;
  if (lapsed) blockedReason = "subscription_lapsed";
  else if (!planHasNewsletters) blockedReason = "plan_excludes_newsletters";

  return {
    ...base,
    onTrial: false,
    comped,
    maySendCampaigns: blockedReason === null,
    daysLeft: null,
    blockedReason,
  };
}

/**
 * What to tell the account holder. Addressed to them, never to their customer,
 * and it always names the thing they can do about it.
 */
export function describeBlock(reason: BlockedReason): string {
  switch (reason) {
    case "trial_expired":
      return "Your free trial has ended. Choose a plan to start sending newsletters again — your inbox and everything in it is untouched.";
    case "trial_ticket_limit":
      return `Your trial covers ${TRIAL_LIMITS.tickets} conversations and you have reached that. Your customers' messages are still arriving and still safe; choose a plan to send newsletters again.`;
    case "trial_subscriber_limit":
      return `Your trial covers ${TRIAL_LIMITS.subscribers} subscribers and you have reached that. New signups are still being confirmed and kept; choose a plan to send to them.`;
    case "subscription_lapsed":
      return "We could not renew your subscription, so newsletter sending is paused. Your inbox is working normally and nothing has been deleted. Update your card to start sending again.";
    case "plan_excludes_newsletters":
      return "Newsletters are not part of your current plan. Upgrade to Growth to send them.";
  }
}

/**
 * Should the dashboard nag, and how loudly?
 *
 * Deliberately gradual. A trial that ends without warning and then simply
 * refuses to work is how somebody finds out they have lost a fortnight — so
 * the banner appears with a week to go and gets more prominent, rather than
 * appearing for the first time on the day it breaks.
 */
export function trialNotice(
  e: Entitlement,
): { tone: "info" | "warn" | "block"; message: string } | null {
  if (e.blockedReason) {
    return { tone: "block", message: describeBlock(e.blockedReason) };
  }
  if (!e.onTrial || e.daysLeft === null) return null;
  if (e.daysLeft > 7) return null;

  return {
    tone: e.daysLeft <= 3 ? "warn" : "info",
    message:
      e.daysLeft === 1
        ? "Last day of your free trial. Choose a plan to keep sending newsletters."
        : `${e.daysLeft} days left of your free trial.`,
  };
}
