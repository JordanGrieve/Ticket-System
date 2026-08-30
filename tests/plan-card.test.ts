import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planCard, type Entitlement } from "../lib/trial";

/**
 * The plan card in the sidebar.
 *
 * ── WHY THIS FILE EXISTS ──
 * The card it replaced was hard-coded copy reading "Plans and billing aren't
 * built yet, so there is nothing to upgrade to", above a permanently disabled
 * button. That was true the day it was written. By the time anybody noticed,
 * /settings/billing, /api/billing/checkout, /api/billing/portal, the Stripe
 * webhook and the `plan` column all existed — so the one panel visible on
 * every signed-in screen was telling paying customers they could not pay.
 *
 * Nothing caught it, because "a component says something false about the rest
 * of the system" is not a type error and not a lint. What follows is the only
 * thing that can catch it: the card is now derived from entitlement, and these
 * pin the derivation.
 */

function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    plan: "trial",
    onTrial: true,
    comped: false,
    mayReceive: true,
    maySendCampaigns: true,
    daysLeft: 14,
    blockedReason: null,
    ...over,
  };
}

describe("what the card says", () => {
  it("counts down a running trial without alarming anybody", () => {
    const c = planCard(ent({ daysLeft: 9 }));
    expect(c.title).toBe("Free trial");
    expect(c.body).toContain("9 days left");
    expect(c.urgent).toBe(false);
  });

  it("says 'last day' rather than '1 days left'", () => {
    expect(planCard(ent({ daysLeft: 1 })).body).toMatch(/^Last day/);
  });

  it("raises its voice once the trial has actually ended", () => {
    const c = planCard(
      ent({ onTrial: false, daysLeft: 0, blockedReason: "trial_expired" }),
    );
    expect(c.title).toBe("Trial ended");
    expect(c.cta).toBe("Choose a plan");
    expect(c.urgent).toBe(true);
  });

  it("names the plan somebody is actually paying for", () => {
    const c = planCard(ent({ plan: "growth", onTrial: false, daysLeft: null }));
    expect(c.title).toBe("Postbox Growth");
    expect(c.cta).toBe("Manage billing");
    expect(c.urgent).toBe(false);
  });

  it("shows a failed payment everywhere, not only when the banner fires", () => {
    /*
     * TrialBanner renders this too, but a lapsed subscription is somebody's
     * card having been declined — the most important thing on the screen, and
     * the banner is dismissible on its quieter tones. The card is permanent.
     */
    const c = planCard(
      ent({
        plan: "growth",
        onTrial: false,
        daysLeft: null,
        maySendCampaigns: false,
        blockedReason: "subscription_lapsed",
      }),
    );
    expect(c.urgent).toBe(true);
    expect(c.cta).toBe("Update your card");
  });

  it("never asks a comped workspace for money", () => {
    // The pilot client and every workspace predating billing are comped.
    const c = planCard(
      ent({ plan: "business", onTrial: false, daysLeft: null, comped: true }),
    );
    expect(c.body).toContain("nothing to pay");
    expect(c.urgent).toBe(false);
    expect(c.body).not.toMatch(/trial/i);
  });

  it("always offers somewhere to go", () => {
    // The failure being guarded is the old one: a card with a dead control.
    for (const e of [
      ent(),
      ent({ onTrial: false, daysLeft: 0, blockedReason: "trial_expired" }),
      ent({ plan: "starter", onTrial: false, daysLeft: null }),
      ent({ comped: true, plan: "business", onTrial: false, daysLeft: null }),
    ]) {
      expect(planCard(e).cta.length).toBeGreaterThan(0);
    }
  });
});

describe("the card cannot go stale again", () => {
  const SHELL = readFileSync(
    join(process.cwd(), "components/mail/MailNavShell.tsx"),
    "utf8",
  );

  it("holds no hard-coded claim about what is or is not built", () => {
    expect(SHELL).not.toMatch(/aren.t\s+built yet/i);
    expect(SHELL).not.toContain("Not available yet");
  });

  it("takes people to billing rather than disabling the control", () => {
    expect(SHELL).toContain('<Link className="pbm-pro-btn" href="/settings/billing">');
    expect(SHELL).not.toMatch(/className="pbm-pro-btn"[^>]*disabled/);
  });
});

describe("the stylesheet does not still say 'dead'", () => {
  const CSS = readFileSync(join(process.cwd(), "app/mail.css"), "utf8");
  const block = CSS.slice(CSS.indexOf(".pbm-pro-btn {"));
  const rule = block.slice(0, block.indexOf("}"));

  it("no longer paints the button as disabled", () => {
    // It kept `opacity: .6; cursor: not-allowed` from when it was one.
    expect(rule).not.toContain("not-allowed");
    expect(rule).not.toMatch(/opacity:\s*0?\.\d/);
  });

  it("centres the label now that it is an anchor and not a button", () => {
    expect(rule).toContain("justify-content: center");
  });
});
