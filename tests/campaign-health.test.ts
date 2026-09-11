import { describe, it, expect } from "vitest";
import {
  diagnoseCampaign,
  healthSummary,
  type CampaignHealthInput,
} from "../lib/campaign-health";
import type { CampaignStatus, RecipientStatus } from "../db/schema";

/**
 * The states nobody can reproduce on demand.
 *
 * Every branch in lib/campaign-health.ts describes a production misconfiguration
 * — an unset secret, a blank postal address, delivery still in log-only mode.
 * Reproducing any of them for real means breaking production, so they are
 * exactly the branches that would otherwise ship untested and be read for the
 * first time by a client whose campaign has stopped.
 *
 * That is why the module takes its environment as an argument instead of
 * reading it.
 */

const NOBODY: Record<RecipientStatus, number> = {
  queued: 0,
  sent: 0,
  delivered: 0,
  bounced: 0,
  complained: 0,
  failed: 0,
};

const HEALTHY_ENV = {
  sweepConfigured: true,
  senderConfigured: true,
  deliveryLive: true,
};

function input(over: Partial<CampaignHealthInput> = {}): CampaignHealthInput {
  return {
    status: "sending" as CampaignStatus,
    listId: 1,
    recipients: { ...NOBODY, queued: 10 },
    postalAddress: "18 Avonbank Crescent, Hamilton, ML3 7PD",
    emailAllowance: { remaining: 5_000, allowance: 15_000 },
    env: HEALTHY_ENV,
    ...over,
  };
}

describe("stalled detection — the reason this module exists", () => {
  it("calls a sending campaign with a blocking reason STALLED, not sending", () => {
    // The distinction the product could not previously make. `sending` with a
    // blocking reason means the sweep will pick it up and refuse it every few
    // minutes forever, and the client cannot edit, cancel or discard their way
    // out of `sending`.
    const h = diagnoseCampaign(input({ postalAddress: null }));
    expect(h.state).toBe("stalled");
    expect(h.remaining).toBe(10);
  });

  it("calls a healthy sending campaign SENDING", () => {
    expect(diagnoseCampaign(input()).state).toBe("sending");
  });

  it("does not call a campaign stalled once the queue has drained", () => {
    // Nothing left to block. A blocking reason with zero queued rows is a
    // configuration note, not a stall.
    const h = diagnoseCampaign(
      input({
        postalAddress: null,
        recipients: { ...NOBODY, sent: 10 },
      }),
    );
    expect(h.state).toBe("sending");
  });

  it.each([
    ["draft", "draft"],
    ["scheduled", "waiting"],
    ["sent", "done"],
    ["failed", "failed"],
  ])("maps status %s to state %s regardless of blockers", (status, expected) => {
    const h = diagnoseCampaign(
      input({ status: status as CampaignStatus, postalAddress: null }),
    );
    expect(h.state).toBe(expected);
  });
});

describe("blockers", () => {
  it("reports a missing postal address as the client's to fix", () => {
    const h = diagnoseCampaign(input({ postalAddress: null }));
    const b = h.blockers.find((x) => x.code === "no_postal_address");
    expect(b?.blocking).toBe(true);
    // The one blocking reason a client can resolve alone, so it must not be
    // presented as "we are on it".
    expect(b?.operatorOnly).toBe(false);
  });

  it("treats whitespace as no address at all", () => {
    const h = diagnoseCampaign(input({ postalAddress: "   \n " }));
    expect(h.blockers.some((b) => b.code === "no_postal_address")).toBe(true);
  });

  it.each([
    ["sweepConfigured", "sweep_not_configured"],
    ["senderConfigured", "sender_not_configured"],
    ["deliveryLive", "log_only_mode"],
  ])("reports %s being off as OPERATOR-only", (key, code) => {
    const h = diagnoseCampaign(
      input({ env: { ...HEALTHY_ENV, [key]: false } as never }),
    );
    const b = h.blockers.find((x) => x.code === code);
    expect(b?.blocking).toBe(true);
    // A client cannot set an environment variable. Telling them to would be
    // worse than telling them nothing.
    expect(b?.operatorOnly).toBe(true);
  });

  it("never leaks an environment variable name to the client", () => {
    // These strings are rendered in a client's dashboard. "Set CRON_SECRET" is
    // not an instruction they can act on, and it advertises internals.
    const h = diagnoseCampaign(
      input({
        postalAddress: null,
        listId: null,
        env: {
          sweepConfigured: false,
          senderConfigured: false,
          deliveryLive: false,
        },
      }),
    );
    const all = h.blockers.map((b) => b.message).join(" ");
    expect(all).not.toMatch(/CRON_SECRET|CAMPAIGN_FROM_ADDRESS|CAMPAIGN_DELIVERY_MODE|env|environment variable/i);
  });

  it("asks for recipients whether or not a list was ever chosen", () => {
    // There are no lists any more — a campaign goes to everyone confirmed in
    // the workspace (lib/campaign-send.ts, workspaceAudience). "Choose a list"
    // was a blocker for a choice the product no longer offers, and with
    // list_subscribers never written it was unsatisfiable besides.
    for (const listId of [null, 1]) {
      const h = diagnoseCampaign(input({ listId, recipients: NOBODY }));
      expect(h.blockers.some((b) => b.code === "no_recipients")).toBe(true);
    }
  });

  it("flags a campaign that finished with every message failed", () => {
    // The most misleading state the product can produce: settleCampaign counts
    // failed rows as drained, so this is marked `sent` while nobody got it.
    const h = diagnoseCampaign(
      input({ status: "sent", recipients: { ...NOBODY, failed: 10 } }),
    );
    const b = h.blockers.find((x) => x.code === "all_recipients_failed");
    expect(b).toBeDefined();
    // Not blocking — there is nothing left to block. It is a warning about
    // what already happened.
    expect(b?.blocking).toBe(false);
    expect(healthSummary(h)).toBe("Finished — nobody received it");
  });

  it("does not flag a partial failure as total", () => {
    const h = diagnoseCampaign(
      input({ status: "sent", recipients: { ...NOBODY, sent: 9, failed: 1 } }),
    );
    expect(h.blockers.some((b) => b.code === "all_recipients_failed")).toBe(false);
    expect(healthSummary(h)).toBe("Sent");
  });

  it("is silent when everything is configured", () => {
    expect(diagnoseCampaign(input()).blockers).toEqual([]);
  });
});

describe("healthSummary", () => {
  it("says stuck before it says why", () => {
    // A client scanning a list needs to know something is wrong before they
    // need to know what.
    const h = diagnoseCampaign(input({ postalAddress: null }));
    expect(healthSummary(h)).toBe("Stuck — 10 not sent");
  });

  it("counts down while sending", () => {
    const h = diagnoseCampaign(
      input({ recipients: { ...NOBODY, queued: 3, sent: 7 } }),
    );
    expect(healthSummary(h)).toBe("Sending — 3 to go");
  });
});

describe("the monthly email allowance", () => {
  it("says so when the month is spent, and tells them what to do", () => {
    const h = diagnoseCampaign(
      input({ emailAllowance: { remaining: 0, allowance: 15_000 } }),
    );
    const b = h.blockers.find((x) => x.code === "email_allowance_spent");
    expect(b, "no blocker for a spent allowance").toBeDefined();
    expect(b!.blocking).toBe(true);
    // The client can fix this by waiting or upgrading, so it is addressed to
    // them — unlike the environment gates, which only the operator can clear.
    expect(b!.operatorOnly).toBe(false);
    expect(b!.message).toMatch(/15,000/);
    expect(b!.message).toMatch(/next month|plan/i);
  });

  it("says nothing while there is allowance left", () => {
    const h = diagnoseCampaign(
      input({ emailAllowance: { remaining: 1, allowance: 15_000 } }),
    );
    expect(h.blockers.some((x) => x.code === "email_allowance_spent")).toBe(false);
  });

  it("says nothing when it could not be read", () => {
    // Null is "we could not tell", not "you are out". Reporting a block we
    // are not sure about would send somebody to the billing page over a
    // database hiccup.
    const h = diagnoseCampaign(input({ emailAllowance: null }));
    expect(h.blockers.some((x) => x.code === "email_allowance_spent")).toBe(false);
  });

  it("names no environment variable", () => {
    // Same rule as every other client-facing blocker in this file.
    const h = diagnoseCampaign(
      input({ emailAllowance: { remaining: 0, allowance: 3_000 } }),
    );
    const msg = h.blockers.map((b) => b.message).join(" ");
    expect(msg).not.toMatch(/CAMPAIGN_|CRON_SECRET|env|environment variable/i);
  });
});
