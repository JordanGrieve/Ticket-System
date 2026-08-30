import type { PlanState } from "@/db/schema";
import { PLANS, planById } from "@/lib/pricing";

/**
 * What the estate is worth, per plan.
 *
 * ── PURE, AND THAT IS THE POINT ──
 * No database, no Stripe SDK, no `process.env`, no clock of its own — `now` is
 * an argument. Every branch below is a claim about money, and the ones that
 * matter (a lapsed subscription, a comped account) are exactly the states
 * nobody can reproduce on demand against a real Stripe account. Passing the
 * inputs in is what makes them testable at all.
 *
 * ── WHAT THIS IS NOT ──
 * It is not revenue. It is the LIST PRICE of the plans currently entitled,
 * which differs from what Stripe will actually collect wherever a coupon, a
 * proration, a partial refund, tax or a currency other than GBP is involved.
 * Postbox stores none of those — invoices live in Stripe and are not mirrored
 * here — so this figure is a floor-plan of the subscriptions, not an account
 * of the money. The console says so on screen; do not quietly promote it to
 * "revenue" somewhere else.
 *
 * Three states are counted apart rather than averaged in, because each one is
 * a different sentence to say out loud:
 *
 *  • TRIAL — worth nothing yet, and correctly so. Never in the MRR.
 *  • COMPED — a paid plan with no Stripe subscription. lib/trial.ts treats
 *    that as free-forever by decision (the pilot client, anything predating
 *    billing, an operator grant). Entitled to everything, billed nothing, so
 *    counting its list price as income would invent money.
 *  • LAPSED — a subscription whose paid period has ended. Still entitled under
 *    the rules in lib/trial.ts until it is downgraded, but nobody is paying
 *    for it this month, so it is excluded from the MRR and reported on its own.
 */

/** The billing columns of a workspace. A subset of `workspaces`. */
export type BillingRow = {
  plan: PlanState;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
};

/** Which of the four money states one workspace is in. */
export type BillingState = "trial" | "paying" | "comped" | "lapsed";

export function billingState(row: BillingRow, now: Date): BillingState {
  if (row.plan === "trial") return "trial";
  // A paid plan that never met Stripe is comped, not broken. Same rule as
  // lib/trial.ts — if the two ever disagree, that file is the authority.
  if (row.stripeSubscriptionId === null) return "comped";
  // Judged on the period actually paid for, not on Stripe's status string, for
  // the reason spelled out in lib/trial.ts: a card retrying for four days is
  // past_due and paid up at the same time.
  if (row.currentPeriodEnd === null || row.currentPeriodEnd.getTime() <= now.getTime())
    return "lapsed";
  return "paying";
}

export type PlanRollupRow = {
  plan: PlanState;
  label: string;
  /** Monthly list price in whole pounds. Null for the trial, which has none. */
  price: number | null;
  /** Every workspace entitled to this plan, whatever it is paying. */
  workspaces: number;
  /** Of those, the ones with a live paid period behind them. */
  paying: number;
  comped: number;
  lapsed: number;
  /** paying × price. Nothing else contributes. */
  mrr: number;
};

export type PlanRollup = {
  /** One row per plan that exists, in price order, trial first. */
  rows: PlanRollupRow[];
  /** Sum of the `paying` columns. */
  mrr: number;
  paying: number;
  comped: number;
  lapsed: number;
  trials: number;
};

export function planRollup(rows: BillingRow[], now: Date): PlanRollup {
  // Every plan gets a row whether or not anybody is on it. A plan that
  // silently vanishes from this table when its last customer leaves is how a
  // pricing tier stops being noticed; a row of zeroes is information.
  const order: { plan: PlanState; label: string; price: number | null }[] = [
    { plan: "trial", label: "Trial", price: null },
    ...[...PLANS]
      .sort((a, b) => a.price - b.price)
      .map((p) => ({ plan: p.id as PlanState, label: p.name, price: p.price })),
  ];

  const out = order.map<PlanRollupRow>((p) => ({
    ...p,
    workspaces: 0,
    paying: 0,
    comped: 0,
    lapsed: 0,
    mrr: 0,
  }));
  const byPlan = new Map(out.map((r) => [r.plan, r]));

  for (const row of rows) {
    const target = byPlan.get(row.plan);
    // A plan id in the database that lib/pricing.ts has never heard of. It is
    // dropped rather than guessed at — the alternative is inventing a price
    // for it — and the count of dropped rows is not reported, because a
    // workspace on an unknown plan is a bug for the schema to answer for, not
    // a number to put beside the money.
    if (!target) continue;
    target.workspaces += 1;
    const state = billingState(row, now);
    if (state === "paying") {
      target.paying += 1;
      target.mrr += target.price ?? 0;
    } else if (state === "comped") target.comped += 1;
    else if (state === "lapsed") target.lapsed += 1;
  }

  return {
    rows: out,
    mrr: out.reduce((n, r) => n + r.mrr, 0),
    paying: out.reduce((n, r) => n + r.paying, 0),
    comped: out.reduce((n, r) => n + r.comped, 0),
    lapsed: out.reduce((n, r) => n + r.lapsed, 0),
    trials: byPlan.get("trial")?.workspaces ?? 0,
  };
}

/**
 * The plan of one workspace, in a phrase.
 *
 * Says the state as well as the name, because "Growth" alone is the answer to
 * a different question than the one an operator is asking when they look at
 * this column — "Growth, not paid since 2 August" is the one they want.
 */
export function describePlan(row: BillingRow, now: Date): string {
  const name = row.plan === "trial" ? "Trial" : (planById(row.plan)?.name ?? row.plan);
  switch (billingState(row, now)) {
    case "trial":
      return "Trial";
    case "comped":
      return `${name} · comped`;
    case "lapsed":
      return `${name} · period ended`;
    case "paying":
      return name;
  }
}
