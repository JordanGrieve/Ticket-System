import { describe, it, expect } from "vitest";
import { maybeSendAutoReply, type AutoReplyDeps } from "../lib/auto-reply-send";
import type { AutoReplyConfig } from "../lib/auto-reply";
import type { Workspace, Ticket } from "../db/schema";

/**
 * maybeSendAutoReply — the WIRING, not the decision.
 *
 * The decision chain has been covered for a while: token substitution,
 * schedule evaluation across DST and half-hour zones, every loop guard. What
 * had no test at all was the part that reads config, looks up the form name,
 * checks what has already been sent, chooses between deferring and dropping,
 * and calls the provider. It needed a database and a mail provider, so the
 * type checker was the only thing verifying it.
 *
 * That is the wrong half to leave untested. This code sends email
 * automatically to addresses supplied by the public internet, and its worst
 * failure is a mail loop: two robots answering each other at machine speed
 * from our sending domain, on the reputation carrying every other tenant's
 * mail.
 *
 * These tests assert the WIRING decisions — what is called, what is not, and
 * what comes back. They deliberately do not re-test the decision logic; a fake
 * deliver() records that it was reached.
 */

const NOW = new Date("2026-08-24T10:00:00Z"); // a Monday, mid-morning

const workspace = {
  id: 1,
  name: "Open Door Bakery",
  sendingEmail: "hello@bakery.example",
} as unknown as Workspace;

const ticket = {
  id: 42,
  formId: null,
  customerName: "Priya Raman",
  customerEmail: "priya@example.com",
  source: "contact_form",
  replyToken: "tok-42",
} as unknown as Ticket;

const enabledConfig = {
  enabled: true,
  subject: "Thanks for getting in touch",
  body: "We have your message, {customer_name}.",
  outOfHoursBody: null,
  delay: "immediate",
  scheduleMode: "always",
  businessHours: null,
  timezone: "Europe/London",
  skipIfTeammateReplied: true,
} as unknown as AutoReplyConfig;

/** Records every call so a test can assert what was NOT reached. */
function spyDeps(over: Partial<AutoReplyDeps> = {}) {
  const calls = {
    loadConfig: 0,
    loadFormName: 0,
    loadOutboundKinds: 0,
    enqueueDeferred: [] as unknown[],
    deliver: 0,
  };

  const deps: AutoReplyDeps = {
    loadConfig: async () => {
      calls.loadConfig += 1;
      return enabledConfig;
    },
    loadFormName: async () => {
      calls.loadFormName += 1;
      return "Contact form";
    },
    loadOutboundKinds: async () => {
      calls.loadOutboundKinds += 1;
      return { hasAutomatedReply: false, hasHumanReply: false };
    },
    enqueueDeferred: async (input) => {
      calls.enqueueDeferred.push(input);
    },
    deliver: async () => {
      calls.deliver += 1;
      return { sent: true, providerId: "prov-1" };
    },
    now: () => NOW,
    ...over,
  };

  return { deps, calls };
}

describe("config gates everything before any work happens", () => {
  it("returns not_configured and touches nothing else when there is no row", async () => {
    const { deps, calls } = spyDeps({ loadConfig: async () => null });
    const out = await maybeSendAutoReply({ workspace, ticket }, deps);

    expect(out).toEqual({ sent: false, reason: "not_configured" });
    // The point: a workspace that never set this up costs no further queries
    // on the ticket-creation path.
    expect(calls.loadFormName).toBe(0);
    expect(calls.loadOutboundKinds).toBe(0);
    expect(calls.deliver).toBe(0);
  });

  it("returns disabled, and still sends nothing, when the row is switched off", async () => {
    const { deps, calls } = spyDeps({
      loadConfig: async () => ({ ...enabledConfig, enabled: false }),
    });
    const out = await maybeSendAutoReply({ workspace, ticket }, deps);

    expect(out).toEqual({ sent: false, reason: "disabled" });
    expect(calls.deliver).toBe(0);
  });
});

describe("a reply that has already happened stops another", () => {
  it("does not send when an automated reply already went out", async () => {
    // The mail-loop guard, at the wiring level: this is what stops a second
    // robot acknowledgement on the same ticket.
    const { deps, calls } = spyDeps({
      loadOutboundKinds: async () => ({
        hasAutomatedReply: true,
        hasHumanReply: false,
      }),
    });
    const out = await maybeSendAutoReply({ workspace, ticket }, deps);

    expect(out.sent).toBe(false);
    expect(calls.deliver).toBe(0);
  });

  it("does not send when a human has already replied", async () => {
    const { deps, calls } = spyDeps({
      loadOutboundKinds: async () => ({
        hasAutomatedReply: false,
        hasHumanReply: true,
      }),
    });
    const out = await maybeSendAutoReply({ workspace, ticket }, deps);

    expect(out.sent).toBe(false);
    expect(calls.deliver).toBe(0);
  });
});

describe("the happy path", () => {
  it("delivers, and reports the provider id", async () => {
    const { deps, calls } = spyDeps();
    const out = await maybeSendAutoReply({ workspace, ticket }, deps);

    expect(out).toEqual({ sent: true, providerId: "prov-1" });
    expect(calls.deliver).toBe(1);
    expect(calls.enqueueDeferred).toEqual([]);
  });
});

describe("nothing here may ever fail the enquiry", () => {
  /*
   * The most important property in this file.
   *
   * maybeSendAutoReply is awaited INLINE on the ticket-creation path in both
   * app/api/inbound and app/api/tickets/[id]. If it throws, the customer's
   * enquiry fails — and the acknowledgement is a courtesy while the enquiry is
   * the entire product. Losing somebody's message because a courtesy email
   * could not be sent would be indefensible.
   */
  it("swallows a config read that throws", async () => {
    const { deps } = spyDeps({
      loadConfig: async () => {
        throw new Error("database is on fire");
      },
    });
    await expect(
      maybeSendAutoReply({ workspace, ticket }, deps),
    ).resolves.toEqual({ sent: false, reason: "send_failed" });
  });

  it("swallows a provider that throws", async () => {
    const { deps } = spyDeps({
      deliver: async () => {
        throw new Error("SES refused");
      },
    });
    await expect(
      maybeSendAutoReply({ workspace, ticket }, deps),
    ).resolves.toEqual({ sent: false, reason: "send_failed" });
  });

  it("swallows a failing deferral write", async () => {
    // The queue is a courtesy on top of a courtesy. It must not be able to
    // take an enquiry down either.
    const { deps } = spyDeps({
      loadOutboundKinds: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(
      maybeSendAutoReply({ workspace, ticket }, deps),
    ).resolves.toEqual({ sent: false, reason: "send_failed" });
  });
});

describe("headers from the inbound payload reach the decision", () => {
  it("suppresses on an auto-submitted header rather than replying to a robot", async () => {
    // The loop guard's actual input. If the wiring failed to pass the payload
    // through, every one of the header tests would still pass and the product
    // would still answer robots.
    const { deps, calls } = spyDeps();
    const out = await maybeSendAutoReply(
      {
        workspace,
        ticket,
        inboundPayload: { headers: { "auto-submitted": "auto-replied" } },
      },
      deps,
    );

    expect(out.sent).toBe(false);
    expect(calls.deliver).toBe(0);
  });
});
