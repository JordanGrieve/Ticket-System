import { describe, it, expect } from "vitest";
import {
  entitlement,
  trialEndsAt,
  trialNotice,
  describeBlock,
  type WorkspaceBilling,
  type BlockedReason,
} from "../lib/trial";
import { PLANS, TRIAL_DAYS, TRIAL_LIMITS } from "../lib/pricing";

/**
 * Every rule here decides whether a business can use something it is paying
 * for, or whether one of its customers gets heard.
 *
 * The single most important assertion in this file is that a customer's
 * enquiry is never dropped for a billing reason. Everything else is money;
 * that one is somebody's actual customer.
 */

const NOW = new Date("2026-08-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ws = (over: Partial<WorkspaceBilling> = {}): WorkspaceBilling => ({
  plan: "trial",
  trialStartedAt: NOW,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  ...over,
});

const noUsage = { tickets: 0, subscribers: 0 };

describe("customer enquiries are never dropped for a billing reason", () => {
  // The person who suffers from a dropped enquiry is the CUSTOMER, who does
  // not know a billing relationship exists and cannot fix it. The business
  // loses a sale over an invoice they may not have seen. There is no billing
  // state in which this may be false.
  const everyState: WorkspaceBilling[] = [
    ws(),
    ws({ trialStartedAt: new Date(NOW.getTime() - 99 * DAY) }),
    ws({ plan: "starter", stripeSubscriptionId: "sub_1", currentPeriodEnd: null }),
    ws({
      plan: "growth",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: new Date(NOW.getTime() - DAY),
    }),
    ws({ plan: "business" }),
  ];

  it.each(everyState.map((w, i) => [i, w]))(
    "state %i still receives",
    (_i, workspace) => {
      const e = entitlement(workspace as WorkspaceBilling, { tickets: 99999, subscribers: 99999 }, NOW);
      expect(e.mayReceive).toBe(true);
    },
  );
});

describe("the trial ends on whichever runs out first", () => {
  it("allows sending on a fresh trial", () => {
    const e = entitlement(ws(), noUsage, NOW);
    expect(e.maySendCampaigns).toBe(true);
    expect(e.onTrial).toBe(true);
    expect(e.blockedReason).toBeNull();
  });

  it("ends after TRIAL_DAYS", () => {
    const started = new Date(NOW.getTime() - TRIAL_DAYS * DAY);
    const e = entitlement(ws({ trialStartedAt: started }), noUsage, NOW);
    expect(e.maySendCampaigns).toBe(false);
    expect(e.blockedReason).toBe("trial_expired");
    expect(e.daysLeft).toBe(0);
  });

  it("ends on the ticket cap even on day one", () => {
    const e = entitlement(ws(), { tickets: TRIAL_LIMITS.tickets, subscribers: 0 }, NOW);
    expect(e.maySendCampaigns).toBe(false);
    expect(e.blockedReason).toBe("trial_ticket_limit");
  });

  it("ends on the subscriber cap even on day one", () => {
    const e = entitlement(ws(), { tickets: 0, subscribers: TRIAL_LIMITS.subscribers }, NOW);
    expect(e.blockedReason).toBe("trial_subscriber_limit");
  });

  it("names the limit that actually bit, not just 'expired'", () => {
    // Telling somebody their trial ended when they hit the subscriber cap on
    // day three sends them to wait for a date that is not the problem.
    const e = entitlement(ws(), { tickets: 0, subscribers: 9999 }, NOW);
    expect(e.blockedReason).toBe("trial_subscriber_limit");
    expect(describeBlock(e.blockedReason as BlockedReason)).toMatch(/subscriber/i);
  });

  it("rounds part-days UP, so 'today' is never reported as 0 days left", () => {
    // With eight hours to go a person has one day left. Saying 0 while the
    // thing still works reads as a bug and provokes a support email.
    const started = new Date(NOW.getTime() - (TRIAL_DAYS * DAY - 8 * 60 * 60 * 1000));
    const e = entitlement(ws({ trialStartedAt: started }), noUsage, NOW);
    expect(e.daysLeft).toBe(1);
    expect(e.maySendCampaigns).toBe(true);
  });

  it("computes the end date from the start date", () => {
    expect(trialEndsAt(NOW).getTime()).toBe(NOW.getTime() + TRIAL_DAYS * DAY);
  });
});

describe("paid plans", () => {
  it("treats a paid plan with no Stripe subscription as comped, never expiring", () => {
    // How the pilot client and every pre-billing workspace are represented
    // (migration 0014), and how an operator grants free access.
    const e = entitlement(ws({ plan: "business" }), { tickets: 99999, subscribers: 99999 }, NOW);
    expect(e.comped).toBe(true);
    expect(e.maySendCampaigns).toBe(true);
    expect(e.blockedReason).toBeNull();
  });

  it("keeps sending while the paid period runs, even if the card failed", () => {
    // Stripe retries for days. Throughout that window the status is past_due
    // but the customer HAS paid for this period. Cutting them off early takes
    // something they bought.
    const e = entitlement(
      ws({
        plan: "growth",
        stripeSubscriptionId: "sub_1",
        currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY),
      }),
      noUsage,
      NOW,
    );
    expect(e.maySendCampaigns).toBe(true);
  });

  it("stops sending once the paid period has actually ended", () => {
    const e = entitlement(
      ws({
        plan: "growth",
        stripeSubscriptionId: "sub_1",
        currentPeriodEnd: new Date(NOW.getTime() - DAY),
      }),
      noUsage,
      NOW,
    );
    expect(e.maySendCampaigns).toBe(false);
    expect(e.blockedReason).toBe("subscription_lapsed");
  });

  it("refuses newsletters on a plan that does not include them", () => {
    // Starter is inbox-only. Selling it as such and then letting it send
    // would make the pricing page a lie.
    expect(PLANS.find((p) => p.id === "starter")?.limits.subscribers).toBe(0);
    const e = entitlement(
      ws({
        plan: "starter",
        stripeSubscriptionId: "sub_1",
        currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY),
      }),
      noUsage,
      NOW,
    );
    expect(e.maySendCampaigns).toBe(false);
    expect(e.blockedReason).toBe("plan_excludes_newsletters");
  });
});

describe("what the account holder is told", () => {
  it("says nothing early in a trial", () => {
    expect(trialNotice(entitlement(ws(), noUsage, NOW))).toBeNull();
  });

  it("speaks up before it breaks, and gets louder as it closes", () => {
    // A trial that ends silently and then refuses to work is how somebody
    // discovers they have lost a fortnight. The notice appears with a week to
    // go and escalates, rather than appearing for the first time on the day
    // everything stops.
    const at = (daysLeft: number) =>
      trialNotice(
        entitlement(
          ws({ trialStartedAt: new Date(NOW.getTime() - (TRIAL_DAYS - daysLeft) * DAY) }),
          noUsage,
          NOW,
        ),
      );

    expect(at(5)?.tone).toBe("info");
    expect(at(3)?.tone).toBe("warn");
    expect(at(1)?.tone).toBe("warn");
    expect(at(1)?.message).toMatch(/last day/i);
  });

  it("escalates to block once it has actually ended", () => {
    const started = new Date(NOW.getTime() - (TRIAL_DAYS + 1) * DAY);
    const n = trialNotice(entitlement(ws({ trialStartedAt: started }), noUsage, NOW));
    expect(n?.tone).toBe("block");
  });

  it("never tells the account holder their data is gone, because it is not", () => {
    // Every one of these messages is read by somebody who is worried. None of
    // them may imply deletion, because nothing is deleted.
    const reasons: BlockedReason[] = [
      "trial_expired",
      "trial_ticket_limit",
      "trial_subscriber_limit",
      "subscription_lapsed",
      "plan_excludes_newsletters",
    ];
    for (const r of reasons) {
      const msg = describeBlock(r);

      // Look for a CLAIM of loss, not the word "deleted" — the lapsed-card
      // message reassures with "nothing has been deleted", which is the exact
      // opposite of the thing being guarded against. A regex that cannot tell
      // those apart would push the copy towards saying less about it, which is
      // the wrong direction for the message somebody reads while worried.
      // The subject has to be something of THEIRS. "nothing has been deleted"
      // shares the verb phrase with "your data has been deleted" and means the
      // opposite, so the subject is what distinguishes them.
      expect(msg).not.toMatch(
        /\b(your|the)\s+[\w\s]{0,20}?(has|have|was|were|will be)\s+(deleted|removed|erased)\b/i,
      );
      expect(msg).not.toMatch(/\byour (data|messages|inbox) (is|are|was|were) (gone|lost)\b/i);
      expect(msg.length).toBeGreaterThan(20);
    }
  });
});

describe("the plan ids in the schema match the pricing module", () => {
  it("every paid PlanState is a real plan", () => {
    // Two lists of plan ids is how a customer pays for one thing and is
    // allowed another.
    for (const id of ["starter", "growth", "business"]) {
      expect(PLANS.some((p) => p.id === id)).toBe(true);
    }
    expect(PLANS).toHaveLength(3);
  });
});
