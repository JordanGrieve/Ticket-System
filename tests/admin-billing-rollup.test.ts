import { describe, it, expect } from "vitest";
import {
  billingState,
  describePlan,
  planRollup,
  type BillingRow,
} from "../app/(admin)/admin/billing-rollup";
import { PLANS, planById } from "../lib/pricing";
import type { PlanState } from "../db/schema";

/**
 * The operator console's money figure.
 *
 * Every assertion here is about a number an operator would repeat to somebody
 * else, which is the whole reason the rollup is a pure function rather than
 * inline JSX: the three states that must NOT be counted as income — trial,
 * comped, lapsed — are precisely the ones nobody can produce on demand against
 * a real Stripe account, so they can only be tested by handing them in.
 */

const NOW = new Date("2026-08-30T12:00:00Z");
const LATER = new Date("2026-09-30T00:00:00Z");
const EARLIER = new Date("2026-08-01T00:00:00Z");

function row(over: Partial<BillingRow> = {}): BillingRow {
  return {
    plan: "trial",
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    ...over,
  };
}

const paying = (plan: PlanState, until = LATER): BillingRow =>
  row({ plan, stripeSubscriptionId: "sub_123", currentPeriodEnd: until });

describe("billingState", () => {
  it("calls a trial a trial, whatever else is on the row", () => {
    expect(billingState(row(), NOW)).toBe("trial");
    // A stale subscription id on a workspace that has been put back on trial
    // must not read as paying. plan is the entitlement; it wins.
    expect(
      billingState(
        row({ stripeSubscriptionId: "sub_old", currentPeriodEnd: LATER }),
        NOW,
      ),
    ).toBe("trial");
  });

  it("calls a paid plan with no subscription comped, not broken", () => {
    expect(billingState(row({ plan: "growth" }), NOW)).toBe("comped");
  });

  it("counts a subscription whose paid period has ended as lapsed", () => {
    expect(billingState(paying("growth", EARLIER), NOW)).toBe("lapsed");
    // A subscription id with no period at all is the same case: nobody has
    // told us they have paid for anything.
    expect(
      billingState(
        row({ plan: "growth", stripeSubscriptionId: "sub_1" }),
        NOW,
      ),
    ).toBe("lapsed");
  });

  it("counts a live paid period as paying", () => {
    expect(billingState(paying("growth"), NOW)).toBe("paying");
  });

  it("uses the instant it is given, not the wall clock", () => {
    const r = paying("growth", new Date("2026-08-30T18:00:00Z"));
    expect(billingState(r, NOW)).toBe("paying");
    expect(billingState(r, new Date("2026-08-31T00:00:00Z"))).toBe("lapsed");
  });
});

describe("planRollup", () => {
  it("gives every plan a row even when nobody is on it", () => {
    const { rows } = planRollup([], NOW);
    expect(rows.map((r) => r.plan)).toEqual([
      "trial",
      ...[...PLANS].sort((a, b) => a.price - b.price).map((p) => p.id),
    ]);
    expect(rows.every((r) => r.workspaces === 0 && r.mrr === 0)).toBe(true);
  });

  it("prices the paying workspaces at the plan's list price", () => {
    const growth = planById("growth");
    expect(growth).not.toBeNull();
    const out = planRollup([paying("growth"), paying("growth")], NOW);
    expect(out.paying).toBe(2);
    expect(out.mrr).toBe(2 * growth!.price);
    const line = out.rows.find((r) => r.plan === "growth");
    expect(line?.mrr).toBe(2 * growth!.price);
    expect(line?.workspaces).toBe(2);
  });

  it("adds the plan lines up to the total", () => {
    const out = planRollup(
      [paying("starter"), paying("growth"), paying("business")],
      NOW,
    );
    expect(out.mrr).toBe(out.rows.reduce((n, r) => n + r.mrr, 0));
    expect(out.mrr).toBe(PLANS.reduce((n, p) => n + p.price, 0));
  });

  it("keeps trials out of the money entirely", () => {
    const out = planRollup([row(), row(), row()], NOW);
    expect(out.trials).toBe(3);
    expect(out.mrr).toBe(0);
    expect(out.paying).toBe(0);
    expect(out.rows.find((r) => r.plan === "trial")?.workspaces).toBe(3);
  });

  it("does not count a trial as paying because a dead subscription id is on it", () => {
    // A workspace put back on trial keeps the id of the subscription it used
    // to have. The trial row has no price, so this cannot show up as money —
    // it would show up as a paying CUSTOMER, which is the same lie one column
    // to the left.
    const out = planRollup(
      [row({ stripeSubscriptionId: "sub_old", currentPeriodEnd: LATER })],
      NOW,
    );
    expect(out.paying).toBe(0);
    expect(out.trials).toBe(1);
    expect(out.rows.find((r) => r.plan === "trial")?.paying).toBe(0);
  });

  it("counts a comped account as an account and not as income", () => {
    const out = planRollup([row({ plan: "business" })], NOW);
    expect(out.comped).toBe(1);
    expect(out.mrr).toBe(0);
    const line = out.rows.find((r) => r.plan === "business");
    expect(line?.workspaces).toBe(1);
    expect(line?.paying).toBe(0);
    expect(line?.comped).toBe(1);
  });

  it("counts a lapsed subscription as an account and not as income", () => {
    const out = planRollup([paying("growth", EARLIER), paying("growth")], NOW);
    expect(out.lapsed).toBe(1);
    expect(out.paying).toBe(1);
    expect(out.mrr).toBe(planById("growth")!.price);
  });

  it("drops a plan id lib/pricing.ts has never heard of rather than pricing it", () => {
    // A workspace on an unrecognised plan is a schema bug, and the one thing
    // this function must never do about it is invent a price. It disappears
    // from the money and from the counts.
    const out = planRollup(
      [{ ...row(), plan: "enterprise" as PlanState }, paying("starter")],
      NOW,
    );
    expect(out.mrr).toBe(planById("starter")!.price);
    expect(out.rows.reduce((n, r) => n + r.workspaces, 0)).toBe(1);
  });
});

describe("describePlan", () => {
  it("names the plan and, when it matters, the state", () => {
    expect(describePlan(row(), NOW)).toBe("Trial");
    expect(describePlan(paying("growth"), NOW)).toBe("Growth");
    expect(describePlan(row({ plan: "growth" }), NOW)).toBe("Growth · comped");
    expect(describePlan(paying("growth", EARLIER), NOW)).toBe(
      "Growth · period ended",
    );
  });
});
