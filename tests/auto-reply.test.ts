import { describe, it, expect } from "vitest";
import {
  DEFAULT_BODY,
  DEFAULT_CONFIG,
  DEFAULT_SUBJECT,
  buildMergeValues,
  decideAutoReply,
  extractHeaders,
  firstNameFrom,
  isAutomatedMail,
  isDelaySupported,
  isRoleOrNoReplyAddress,
  isSelfAddress,
  renderTemplate,
  type AutoReplyConfig,
  type DecisionInput,
} from "../lib/auto-reply";
import { EMAIL_FROM_ADDRESS, INBOUND_DOMAIN } from "../lib/config";

const WORKSPACE = {
  name: "Bramble Bakery",
  inboundEmail: `bakery-a1b2c3@${INBOUND_DOMAIN}`,
  sendingEmail: "hello@bramblebakery.co.uk",
};

// ── token substitution ───────────────────────────────────────────

describe("first-name resolution", () => {
  it("takes the first word of a real name and normalises case", () => {
    expect(firstNameFrom("Alex Fenton")).toBe("Alex");
    expect(firstNameFrom("alex fenton")).toBe("Alex");
    expect(firstNameFrom("ALEX FENTON")).toBe("Alex");
    // Mixed case is left alone — don't mangle McDonald or O'Neill.
    expect(firstNameFrom("McDonald Smith")).toBe("McDonald");
  });

  it("treats an address-as-name as unknown", () => {
    // Inbound mail with no display name is stored as customerName = email,
    // so this is the common case rather than an edge case.
    expect(firstNameFrom("bob.smith@acme.co")).toBe("there");
    expect(firstNameFrom("Bob@acme.co", "bob@acme.co")).toBe("there");
  });

  it("falls back for empty, single-letter and junk names", () => {
    expect(firstNameFrom("")).toBe("there");
    expect(firstNameFrom("   ")).toBe("there");
    expect(firstNameFrom(null)).toBe("there");
    expect(firstNameFrom(undefined)).toBe("there");
    expect(firstNameFrom("X")).toBe("there");
    expect(firstNameFrom("user1234")).toBe("there");
    expect(firstNameFrom("https://spam.example")).toBe("there");
  });

  it("strips quoting punctuation around the name", () => {
    expect(firstNameFrom('"Alex" Fenton')).toBe("Alex");
    expect(firstNameFrom("Alex, Fenton")).toBe("Alex");
  });
});

describe("template rendering", () => {
  const values = buildMergeValues({
    customerName: "Alex Fenton",
    customerEmail: "alex@example.com",
    formName: "Wholesale enquiries",
    source: "contact_form",
    workspaceName: "Bramble Bakery",
  });

  it("substitutes every known token", () => {
    expect(
      renderTemplate("Hi {first_name}, thanks via {form_name}. — {company}", values),
    ).toBe("Hi Alex, thanks via Wholesale enquiries. — Bramble Bakery");
  });

  it("is case- and whitespace-tolerant inside the braces", () => {
    expect(renderTemplate("Hi {First_Name}", values)).toBe("Hi Alex");
    expect(renderTemplate("Hi { first_name }", values)).toBe("Hi Alex");
  });

  it("NEVER lets a literal token reach the customer", () => {
    // The single most important property in this file: an unknown or
    // misspelled token is deleted, not passed through.
    const out = renderTemplate(
      "Hi {firstname}, about {order_id} and {company}",
      values,
    );
    expect(out).not.toMatch(/[{}]/);
    expect(out).toBe("Hi, about and Bramble Bakery");
  });

  it("leaves no literal token in the shipped default templates", () => {
    const unknown = buildMergeValues({
      customerName: "",
      customerEmail: "",
      formName: null,
      source: "email",
      workspaceName: "Bramble Bakery",
    });
    for (const template of [DEFAULT_SUBJECT, DEFAULT_BODY]) {
      expect(renderTemplate(template, unknown)).not.toMatch(/[{}]/);
    }
    expect(renderTemplate(DEFAULT_SUBJECT, unknown)).toBe(
      "We got your message, there",
    );
  });

  it("tidies the whitespace a deleted token leaves behind", () => {
    expect(renderTemplate("Hi  {nope}  there", values)).toBe("Hi there");
    expect(renderTemplate("Regards {nope},", values)).toBe("Regards,");
  });

  it("preserves paragraph breaks", () => {
    expect(renderTemplate("Hi {first_name},\n\nThanks.", values)).toBe(
      "Hi Alex,\n\nThanks.",
    );
  });

  it("falls back per token when a value is missing", () => {
    const bare = buildMergeValues({
      customerName: null,
      customerEmail: "someone@example.com",
      formName: null,
      source: "email",
      workspaceName: "Bramble Bakery",
    });
    expect(renderTemplate("Hi {first_name} via {form_name}", bare)).toBe(
      "Hi there via email",
    );
    const formTicket = buildMergeValues({
      customerName: null,
      customerEmail: "someone@example.com",
      formName: null,
      source: "contact_form",
      workspaceName: "Bramble Bakery",
    });
    expect(renderTemplate("via {form_name}", formTicket)).toBe(
      "via our contact form",
    );
  });
});

// ── loop guards ──────────────────────────────────────────────────

describe("self-address guard", () => {
  it("refuses our own sending and inbound addresses", () => {
    expect(isSelfAddress(EMAIL_FROM_ADDRESS, WORKSPACE)).toBe(true);
    expect(isSelfAddress(WORKSPACE.inboundEmail, WORKSPACE)).toBe(true);
    expect(isSelfAddress(WORKSPACE.sendingEmail, WORKSPACE)).toBe(true);
    expect(isSelfAddress(WORKSPACE.sendingEmail.toUpperCase(), WORKSPACE)).toBe(
      true,
    );
  });

  it("refuses anything on the inbound domain, including other tenants", () => {
    expect(isSelfAddress(`someone-else@${INBOUND_DOMAIN}`, WORKSPACE)).toBe(true);
  });

  it("refuses per-ticket reply addresses", () => {
    expect(
      isSelfAddress(`ticket+TKT-99-deadbeef@${INBOUND_DOMAIN}`, WORKSPACE),
    ).toBe(true);
  });

  it("allows an ordinary customer", () => {
    expect(isSelfAddress("alex@example.com", WORKSPACE)).toBe(false);
  });
});

describe("role / no-reply address guard", () => {
  it("refuses machine mailboxes", () => {
    for (const addr of [
      "noreply@shop.example",
      "no-reply@shop.example",
      "no.reply@shop.example",
      "donotreply@shop.example",
      "do-not-reply@shop.example",
      "mailer-daemon@mail.example",
      "postmaster@mail.example",
      "bounces@list.example",
      "abuse@isp.example",
      "listserv@uni.example",
    ]) {
      expect(isRoleOrNoReplyAddress(addr), addr).toBe(true);
    }
  });

  it("refuses list plumbing suffixes and VERP bounce addresses", () => {
    expect(isRoleOrNoReplyAddress("newsletter-bounces@list.example")).toBe(true);
    expect(isRoleOrNoReplyAddress("discuss-request@list.example")).toBe(true);
    expect(isRoleOrNoReplyAddress("news-owner@list.example")).toBe(true);
    expect(isRoleOrNoReplyAddress("bounce+abc123@sender.example")).toBe(true);
  });

  it("refuses anything that isn't a mailbox", () => {
    expect(isRoleOrNoReplyAddress("")).toBe(true);
    expect(isRoleOrNoReplyAddress("not-an-address")).toBe(true);
    expect(isRoleOrNoReplyAddress("@example.com")).toBe(true);
  });

  it("allows ordinary people, including tagged addresses", () => {
    expect(isRoleOrNoReplyAddress("alex@example.com")).toBe(false);
    expect(isRoleOrNoReplyAddress("alex+shop@example.com")).toBe(false);
    expect(isRoleOrNoReplyAddress("sales@customer.example")).toBe(false);
  });
});

describe("automated / bulk mail guard", () => {
  it("normalises both webhook header shapes", () => {
    expect(
      extractHeaders({ headers: [{ name: "Auto-Submitted", value: "auto-replied" }] }),
    ).toEqual({ "auto-submitted": "auto-replied" });
    expect(extractHeaders({ headers: { "Precedence": "bulk" } })).toEqual({
      precedence: "bulk",
    });
    expect(extractHeaders(null)).toEqual({});
    expect(extractHeaders({})).toEqual({});
  });

  it("refuses RFC 3834 automated mail", () => {
    expect(isAutomatedMail({ "auto-submitted": "auto-replied" })).toBe(true);
    expect(isAutomatedMail({ "auto-submitted": "auto-generated" })).toBe(true);
    // "no" is the explicit "this is a human" value.
    expect(isAutomatedMail({ "auto-submitted": "no" })).toBe(false);
  });

  it("refuses bulk precedence and Exchange suppression", () => {
    expect(isAutomatedMail({ precedence: "bulk" })).toBe(true);
    expect(isAutomatedMail({ precedence: "list" })).toBe(true);
    expect(isAutomatedMail({ precedence: "junk" })).toBe(true);
    expect(isAutomatedMail({ "x-auto-response-suppress": "OOF, AutoReply" })).toBe(
      true,
    );
  });

  it("refuses mailing lists — one reply there hits every subscriber", () => {
    expect(isAutomatedMail({ "list-id": "<dev.list.example>" })).toBe(true);
    expect(isAutomatedMail({ "list-unsubscribe": "<mailto:x@y.example>" })).toBe(
      true,
    );
  });

  it("refuses bounces with a null return-path", () => {
    expect(isAutomatedMail({ "return-path": "<>" })).toBe(true);
    expect(isAutomatedMail({ "return-path": "<alex@example.com>" })).toBe(false);
  });

  it("allows ordinary human mail and missing headers", () => {
    expect(isAutomatedMail({ subject: "Hello", from: "alex@example.com" })).toBe(
      false,
    );
    expect(isAutomatedMail({})).toBe(false);
    expect(isAutomatedMail(null)).toBe(false);
    expect(isAutomatedMail(undefined)).toBe(false);
  });
});

// ── the full decision ────────────────────────────────────────────

const ENABLED: AutoReplyConfig = {
  ...DEFAULT_CONFIG,
  enabled: true,
  scheduleMode: "always",
  timezone: "UTC",
};

function decide(overrides: Partial<DecisionInput> = {}) {
  return decideAutoReply({
    config: ENABLED,
    workspace: WORKSPACE,
    ticket: {
      customerName: "Alex Fenton",
      customerEmail: "alex@example.com",
      source: "contact_form",
    },
    formName: "Wholesale enquiries",
    headers: {},
    hasOutboundMessage: false,
    now: new Date("2025-07-15T12:00:00Z"), // Tue midday
    ...overrides,
  });
}

describe("decideAutoReply", () => {
  it("sends for an ordinary new enquiry", () => {
    const d = decide();
    expect(d.send).toBe(true);
    if (d.send) {
      expect(d.subject).toBe("We got your message, Alex");
      expect(d.body).toContain("Hi Alex,");
      expect(d.body).toContain("Wholesale enquiries");
      expect(d.body).not.toMatch(/[{}]/);
    }
  });

  it("stays quiet when there is no config or it is switched off", () => {
    expect(decide({ config: null })).toEqual({
      send: false,
      reason: "not_configured",
    });
    expect(decide({ config: { ...ENABLED, enabled: false } })).toEqual({
      send: false,
      reason: "disabled",
    });
  });

  it("refuses to answer ourselves — the instant infinite loop", () => {
    expect(
      decide({
        ticket: {
          customerName: "Postbox",
          customerEmail: EMAIL_FROM_ADDRESS,
          source: "email",
        },
      }),
    ).toEqual({ send: false, reason: "self_address" });
    expect(
      decide({
        ticket: {
          customerName: "Inbox",
          customerEmail: WORKSPACE.inboundEmail,
          source: "email",
        },
      }),
    ).toEqual({ send: false, reason: "self_address" });
  });

  it("refuses role and no-reply mailboxes", () => {
    expect(
      decide({
        ticket: {
          customerName: "Shop",
          customerEmail: "noreply@shop.example",
          source: "email",
        },
      }),
    ).toEqual({ send: false, reason: "role_address" });
  });

  it("refuses mail that declares itself automated or bulk", () => {
    expect(decide({ headers: { "auto-submitted": "auto-replied" } })).toEqual({
      send: false,
      reason: "automated_mail",
    });
    expect(decide({ headers: { "list-id": "<announce.example>" } })).toEqual({
      send: false,
      reason: "automated_mail",
    });
  });

  it("refuses an unusable recipient", () => {
    expect(
      decide({
        ticket: {
          customerName: "Nobody",
          customerEmail: "not-an-address",
          source: "email",
        },
      }),
    ).toEqual({ send: false, reason: "invalid_recipient" });
  });

  it("only ever acknowledges once — and never over a teammate", () => {
    expect(decide({ hasOutboundMessage: true })).toEqual({
      send: false,
      reason: "already_answered",
    });
    // Unconditional: it does not matter what skipIfTeammateReplied says,
    // because we cannot tell our own acknowledgement from an agent's reply.
    expect(
      decide({
        hasOutboundMessage: true,
        config: { ...ENABLED, skipIfTeammateReplied: false },
      }),
    ).toEqual({ send: false, reason: "already_answered" });
  });

  it("refuses a delay it cannot honour instead of silently dropping it", () => {
    expect(isDelaySupported("immediate")).toBe(true);
    expect(isDelaySupported("5min")).toBe(false);
    expect(decide({ config: { ...ENABLED, delay: "5min" } })).toEqual({
      send: false,
      reason: "delay_unsupported",
    });
  });

  it("applies the schedule in the workspace's own timezone", () => {
    const businessOnly: AutoReplyConfig = {
      ...ENABLED,
      scheduleMode: "business_hours",
      businessHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
      timezone: "America/New_York",
    };
    // Tue 12:00 UTC = 08:00 New York — still shut.
    expect(decide({ config: businessOnly })).toEqual({
      send: false,
      reason: "schedule",
    });
    // Tue 14:00 UTC = 10:00 New York — open.
    expect(
      decide({ config: businessOnly, now: new Date("2025-07-15T14:00:00Z") }).send,
    ).toBe(true);
  });

  it("swaps in the out-of-hours body outside the window", () => {
    const config: AutoReplyConfig = {
      ...ENABLED,
      scheduleMode: "always",
      businessHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
      timezone: "UTC",
      body: "Open: {first_name}",
      outOfHoursBody: "Closed: {first_name}",
    };
    const open = decide({ config, now: new Date("2025-07-15T12:00:00Z") });
    expect(open.send && open.body).toBe("Open: Alex");
    const shut = decide({ config, now: new Date("2025-07-15T22:00:00Z") });
    expect(shut.send && shut.body).toBe("Closed: Alex");
  });

  it("uses the main body out of hours when no out-of-hours copy is set", () => {
    const config: AutoReplyConfig = {
      ...ENABLED,
      businessHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
      timezone: "UTC",
      body: "Only body",
      outOfHoursBody: null,
    };
    const shut = decide({ config, now: new Date("2025-07-15T22:00:00Z") });
    expect(shut.send && shut.body).toBe("Only body");
  });
});
