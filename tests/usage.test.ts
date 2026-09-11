import { describe, it, expect } from "vitest";
import {
  budgetFor,
  checkAllowance,
  emailAllowance,
  ENFORCEMENT,
  periodKey,
  USAGE_METRICS,
} from "../lib/usage";
import { PLANS, TRIAL_LIMITS } from "../lib/pricing";

/**
 * The usage rules, without a database.
 *
 * These decide whether a paying customer may send, so every one of them is
 * worth running. The one that matters most is `budgetFor`: it is what stands
 * between a plan limit and an SES bill.
 */

describe("the period key", () => {
  it("is the UTC calendar month", () => {
    expect(periodKey(new Date("2026-09-11T10:00:00Z"))).toBe("2026-09");
    expect(periodKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(periodKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("pads the month, so the key sorts", () => {
    // "2026-9" would sort after "2026-10", and a usage history that cannot be
    // ordered is a usage history nobody can chart.
    expect(periodKey(new Date("2026-03-04T00:00:00Z"))).toBe("2026-03");
  });

  it("uses UTC, not the machine's zone", () => {
    // 23:30 on the 30th in London during BST is 22:30 UTC the same day, but
    // an instant just after midnight UTC belongs to the NEXT month wherever
    // the server happens to be. Two workspaces must never disagree about
    // which month an email fell in.
    expect(periodKey(new Date("2026-09-30T23:30:00Z"))).toBe("2026-09");
    expect(periodKey(new Date("2026-10-01T00:30:00Z"))).toBe("2026-10");
  });
});

describe("allowances", () => {
  it("reads the figure off the plan", () => {
    for (const p of PLANS) {
      expect(emailAllowance(p.id), p.id).toBe(p.limits.emailsPerMonth);
    }
  });

  it("gives a trial the trial ceiling", () => {
    expect(emailAllowance("trial")).toBe(TRIAL_LIMITS.emails);
  });

  it("every plan actually carries one", () => {
    // A plan added without an email limit would fall through to zero and
    // block its customer's sending entirely on their first day.
    for (const p of PLANS) {
      expect(p.limits.emailsPerMonth, p.id).toBeGreaterThan(0);
    }
  });

  it("the ladder never goes backwards", () => {
    // Upgrading must never buy less of anything.
    for (let i = 1; i < PLANS.length; i++) {
      const prev = PLANS[i - 1]!.limits;
      const here = PLANS[i]!.limits;
      expect(here.emailsPerMonth, PLANS[i]!.id).toBeGreaterThanOrEqual(prev.emailsPerMonth);
      expect(here.seats, PLANS[i]!.id).toBeGreaterThanOrEqual(prev.seats);
      expect(here.subscribers, PLANS[i]!.id).toBeGreaterThanOrEqual(prev.subscribers);
    }
  });

  it("a trial is smaller than the cheapest plan", () => {
    // Otherwise the trial is a better deal than paying for it.
    expect(TRIAL_LIMITS.emails).toBeLessThan(PLANS[0]!.limits.emailsPerMonth);
  });
});

describe("what is left", () => {
  it("counts down", () => {
    expect(checkAllowance(0, 1000)).toMatchObject({ remaining: 1000, exhausted: false });
    expect(checkAllowance(400, 1000)).toMatchObject({ remaining: 600, exhausted: false });
    expect(checkAllowance(1000, 1000)).toMatchObject({ remaining: 0, exhausted: true });
  });

  it("never reports a negative remainder", () => {
    // Reachable: a batch is budgeted before it is claimed, and a plan
    // downgraded mid-month leaves a workspace over its new allowance.
    expect(checkAllowance(1500, 1000)).toMatchObject({ remaining: 0, exhausted: true });
  });

  it("warns before it bites, not when it does", () => {
    expect(checkAllowance(799, 1000).warn).toBe(false);
    expect(checkAllowance(800, 1000).warn).toBe(true);
    // A plan with no allowance at all warns immediately rather than dividing
    // by zero and reporting a comfortable false.
    expect(checkAllowance(0, 0).warn).toBe(true);
  });
});

describe("budgeting a batch", () => {
  it("gives the whole batch when there is room", () => {
    expect(budgetFor(75, 0, 1000)).toBe(75);
  });

  it("gives a PARTIAL batch rather than refusing", () => {
    // The rule that matters. A campaign of 500 against 80 remaining sends 80
    // and stops; the rest stay queued. Refusing outright would strand a
    // campaign that could have gone most of the way, and sending all 500
    // would be the overage this limit exists to prevent.
    expect(budgetFor(500, 920, 1000)).toBe(80);
  });

  it("gives nothing when the allowance is spent", () => {
    expect(budgetFor(75, 1000, 1000)).toBe(0);
    expect(budgetFor(75, 2000, 1000)).toBe(0);
  });

  it("never returns more than was asked for", () => {
    expect(budgetFor(10, 0, 1_000_000)).toBe(10);
  });
});

describe("how each metric is enforced", () => {
  it("classifies every metric", () => {
    for (const m of USAGE_METRICS) expect(ENFORCEMENT[m], m).toBeDefined();
  });

  it("blocks sending and never blocks receiving", () => {
    /*
      The rule lib/trial.ts argues at length: an unpaid invoice must never
      cost a business their customers' enquiries, because the person who
      suffers is the customer, who has no idea a billing relationship exists.

      If this test ever fails because tickets_opened became "blocks_sending",
      read that file before changing it back.
    */
    expect(ENFORCEMENT.emails_sent).toBe("blocks_sending");
    expect(ENFORCEMENT.tickets_opened).toBe("metered_only");
  });
});
