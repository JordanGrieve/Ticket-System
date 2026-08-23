import { describe, it, expect } from "vitest";
import {
  onboardingSteps,
  onboardingProgress,
  type OnboardingFacts,
} from "../lib/onboarding";

/**
 * The setup checklist.
 *
 * The property worth protecting here is that it never claims something is done
 * when it is not — a checklist that says "your form is connected" for a
 * workspace no form has ever reached is worse than no checklist, because
 * somebody stops looking for the problem.
 */

const none: OnboardingFacts = {
  hasFormTicket: false,
  hasAnyTicket: false,
  autoReplyEnabled: false,
  hasPostalAddress: false,
  hasSubscriber: false,
  hasTeammate: false,
  newslettersAvailable: true,
};

const all: OnboardingFacts = {
  hasFormTicket: true,
  hasAnyTicket: true,
  autoReplyEnabled: true,
  hasPostalAddress: true,
  hasSubscriber: true,
  hasTeammate: true,
  newslettersAvailable: true,
};

describe("a brand new workspace", () => {
  it("has nothing done", () => {
    const p = onboardingProgress(none);
    expect(p.done).toBe(0);
    expect(p.complete).toBe(false);
    expect(p.steps.every((s) => !s.done)).toBe(true);
  });

  it("points at connecting the form first", () => {
    // Until an enquiry can reach the inbox, nothing else in the product does
    // anything at all.
    expect(onboardingProgress(none).next?.id).toBe("connect_form");
  });

  it("puts the postal address before collecting subscribers", () => {
    // It is the field that makes a send legally possible, and finding it
    // missing at send time — campaign written, audience waiting — is the worst
    // possible moment.
    const ids = onboardingSteps(none).map((s) => s.id);
    expect(ids.indexOf("postal_address")).toBeLessThan(
      ids.indexOf("first_subscriber"),
    );
  });
});

describe("what counts as connected", () => {
  it("accepts a forwarded email, not just a form submission", () => {
    // A workspace forwarding its support address is just as connected. Telling
    // them their form is not set up while their mail is arriving would be
    // plainly, visibly wrong.
    const p = onboardingProgress({ ...none, hasAnyTicket: true });
    expect(p.steps.find((s) => s.id === "connect_form")?.done).toBe(true);
  });

  it("does not count an auto-reply that exists but is switched off", () => {
    // The row existing means somebody opened the screen. It does not mean a
    // customer will ever hear back.
    expect(
      onboardingProgress({ ...none, autoReplyEnabled: false }).steps.find(
        (s) => s.id === "auto_reply",
      )?.done,
    ).toBe(false);
  });
});

describe("completion", () => {
  it("is complete when every required step is done, even without a teammate", () => {
    // "Skip it if it is just you" has to actually be skippable, or a sole
    // trader can never finish their own setup.
    const p = onboardingProgress({ ...all, hasTeammate: false });
    expect(p.complete).toBe(true);
    expect(p.done).toBe(p.total);
    expect(p.next?.id).toBe("invite_team");
  });

  it("has nothing left to suggest when everything is done", () => {
    const p = onboardingProgress(all);
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
  });

  it("counts only required steps in the progress figure", () => {
    // "1 of 5" when one of those five is optional would mean the bar never
    // reaches the end for somebody working alone.
    const p = onboardingProgress(none);
    expect(p.total).toBe(onboardingSteps(none).filter((s) => !s.optional).length);
    expect(p.total).toBe(4);
  });
});

describe("steps un-tick when the thing stops being true", () => {
  it("brings back the auto-reply step if it is switched off again", () => {
    // Derived, not remembered. The list describes the workspace as it is now,
    // not a history of buttons pressed.
    expect(onboardingProgress(all).complete).toBe(true);
    const off = onboardingProgress({ ...all, autoReplyEnabled: false });
    expect(off.complete).toBe(false);
    expect(off.next?.id).toBe("auto_reply");
  });
});

describe("every step can be acted on", () => {
  it("gives each one a destination and a reason", () => {
    for (const step of onboardingSteps(none)) {
      expect(step.href.startsWith("/")).toBe(true);
      expect(step.title.length).toBeGreaterThan(4);
      // The detail says what it unlocks. A checklist item with no "why" is an
      // instruction, and people skip instructions.
      expect(step.detail.length).toBeGreaterThan(30);
    }
  });
});

describe("a plan without newsletters", () => {
  // Starter is inbox-only. Showing "get your first subscriber" to a Starter
  // customer is not a step they have not done — it is one they cannot do, and
  // a checklist that can never finish reads as a broken product rather than as
  // a plan boundary.
  const starter = { ...none, newslettersAvailable: false };

  it("drops the two newsletter steps entirely", () => {
    const ids = onboardingSteps(starter).map((s) => s.id);
    expect(ids).not.toContain("first_subscriber");
    expect(ids).not.toContain("postal_address");
    expect(ids).toContain("connect_form");
    expect(ids).toContain("auto_reply");
  });

  it("can actually be finished", () => {
    const p = onboardingProgress({
      ...starter,
      hasAnyTicket: true,
      autoReplyEnabled: true,
    });
    expect(p.complete).toBe(true);
    expect(p.total).toBe(2);
  });

  it("still offers the optional team step", () => {
    expect(onboardingSteps(starter).some((s) => s.id === "invite_team")).toBe(true);
  });
});
