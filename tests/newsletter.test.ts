import { describe, it, expect } from "vitest";
import {
  NO_BRAND,
  buildCampaignMergeValues,
  firstNameFrom,
  fullNameFrom,
  isTemplateKey,
  listUnsubscribeHeaders,
  mailableSender,
  normaliseEmail,
  parseCampaignInput,
  renderCampaign,
  renderTemplate,
  unsubscribeUrl,
  UNKNOWN_FIRST_NAME,
} from "../lib/newsletter";

/**
 * Pure logic only. Nothing here imports the database, a provider, or
 * lib/config, so the whole file runs with no DATABASE_URL — which CI depends
 * on, and which is the reason lib/newsletter.ts is split from
 * lib/campaign-send.ts in the first place.
 */

// ── Name resolution ──────────────────────────────────────────────

describe("name resolution", () => {
  it("takes a first name and normalises shouting or all-lowercase", () => {
    expect(firstNameFrom("Alex Fenton")).toBe("Alex");
    expect(firstNameFrom("alex fenton")).toBe("Alex");
    expect(firstNameFrom("ALEX FENTON")).toBe("Alex");
    // Mixed case is left alone — don't mangle McDonald or O'Neill.
    expect(firstNameFrom("McDonald Smith")).toBe("McDonald");
  });

  it("treats an address-as-name as unknown", () => {
    // The common shape of a CSV import: the address ends up in the name column.
    expect(firstNameFrom("bob.smith@acme.co")).toBe(UNKNOWN_FIRST_NAME);
    expect(firstNameFrom("Bob@acme.co", "bob@acme.co")).toBe(UNKNOWN_FIRST_NAME);
    expect(fullNameFrom("bob@acme.co")).toBe(UNKNOWN_FIRST_NAME);
  });

  it("falls back for empty, single-letter and junk names", () => {
    expect(firstNameFrom("")).toBe(UNKNOWN_FIRST_NAME);
    expect(firstNameFrom(null)).toBe(UNKNOWN_FIRST_NAME);
    expect(firstNameFrom(undefined)).toBe(UNKNOWN_FIRST_NAME);
    expect(firstNameFrom("X")).toBe(UNKNOWN_FIRST_NAME);
    expect(firstNameFrom("user1234")).toBe(UNKNOWN_FIRST_NAME);
  });

  it("keeps the whole name for full_name and collapses whitespace", () => {
    expect(fullNameFrom("  Alex   Fenton ")).toBe("Alex Fenton");
  });
});

// ── Merge-tag substitution ───────────────────────────────────────

const VALUES = buildCampaignMergeValues({
  name: "Alex Fenton",
  email: "alex@example.com",
  workspaceName: "Bramble Bakery",
  unsubscribeUrl: "https://postbox.help/u/abc123",
});

describe("merge-tag substitution", () => {
  it("substitutes every supported token", () => {
    expect(renderTemplate("Hi {first_name},", VALUES)).toBe("Hi Alex,");
    expect(renderTemplate("{name}", VALUES)).toBe("Alex Fenton");
    expect(renderTemplate("{email}", VALUES)).toBe("alex@example.com");
    expect(renderTemplate("— {company}", VALUES)).toBe("— Bramble Bakery");
    expect(renderTemplate("{unsubscribe_url}", VALUES)).toBe(
      "https://postbox.help/u/abc123",
    );
  });

  it("is case- and whitespace-tolerant inside the braces", () => {
    expect(renderTemplate("Hi {FIRST_NAME},", VALUES)).toBe("Hi Alex,");
    expect(renderTemplate("Hi { first_name },", VALUES)).toBe("Hi Alex,");
  });

  it("NEVER lets an unknown token reach a recipient", () => {
    // The whole point: 40,000 people reading "{firstname}" is unrecoverable.
    expect(renderTemplate("Hi {firstname},", VALUES)).toBe("Hi,");
    expect(renderTemplate("Order {order_id} shipped.", VALUES)).toBe(
      "Order shipped.",
    );
    expect(renderTemplate("{}{unknown}", VALUES)).toBe("{}");
  });

  it("tidies the gap a deleted token leaves behind", () => {
    expect(renderTemplate("Hi  {nope}  there", VALUES)).toBe("Hi there");
    expect(renderTemplate("Hello {nope} , welcome", VALUES)).toBe(
      "Hello, welcome",
    );
  });

  it("preserves paragraph breaks", () => {
    const out = renderTemplate("Hi {first_name},\n\nNews below.", VALUES);
    expect(out).toBe("Hi Alex,\n\nNews below.");
  });

  it("falls back to a neutral greeting rather than a bare comma", () => {
    const anon = buildCampaignMergeValues({
      name: null,
      email: "someone@example.com",
      workspaceName: "Bramble Bakery",
      unsubscribeUrl: "https://postbox.help/u/x",
    });
    expect(renderTemplate("Hi {first_name},", anon)).toBe("Hi there,");
  });

  it("uses a fallback company name rather than emptying the signature", () => {
    const blank = buildCampaignMergeValues({
      name: "Alex",
      email: "a@b.co",
      workspaceName: "   ",
      unsubscribeUrl: "https://postbox.help/u/x",
    });
    expect(blank.company).toBe("our team");
  });
});

// ── Rendering ────────────────────────────────────────────────────

/**
 * A workspace that is lawfully able to send. renderCampaign THROWS without a
 * postal address, so every render below has to carry one — which is the point:
 * the type system and the renderer between them make it impossible to build a
 * commercial message that omits the CAN-SPAM identification block.
 */
const SENDER = {
  workspaceName: "Bramble Bakery",
  legalName: "Bramble Bakery Ltd",
  postalAddress: ["12 High Street", "Harrogate", "HG1 1AA"].join("\n"),
};

const CAMPAIGN = {
  subject: "News from {company}",
  preheader: "This month at the bakery",
  templateKey: "plain",
  body: "Hi {first_name},\n\nWe have new sourdough.",
};

describe("campaign rendering", () => {
  const rendered = renderCampaign({
    campaign: CAMPAIGN,
    recipient: { email: "alex@example.com", name: "Alex Fenton" },
    workspaceName: "Bramble Bakery",
    unsubscribeUrl: "https://postbox.help/u/tok123",
    brand: NO_BRAND,
    sender: SENDER,
  });

  it("merges the subject as well as the body", () => {
    expect(rendered.subject).toBe("News from Bramble Bakery");
    expect(rendered.text).toContain("Hi Alex,");
    expect(rendered.html).toContain("Hi Alex,");
  });

  it("appends an unsubscribe link to BOTH parts, always", () => {
    // Not configurable on purpose: one client deleting it would cost every
    // other tenant on the sending domain their inbox placement.
    expect(rendered.text).toContain("https://postbox.help/u/tok123");
    expect(rendered.html).toContain('href="https://postbox.help/u/tok123"');
  });

  it("adds the unsubscribe link even when the author never used the token", () => {
    const bare = renderCampaign({
      campaign: { ...CAMPAIGN, body: "No token here at all." },
      recipient: { email: "a@b.co", name: null },
      workspaceName: "W",
      unsubscribeUrl: "https://postbox.help/u/zzz",
      brand: NO_BRAND,
      sender: SENDER,
    });
    expect(bare.text).toContain("https://postbox.help/u/zzz");
    expect(bare.html).toContain("https://postbox.help/u/zzz");
  });

  it("emits the preheader as hidden text so the inbox preview isn't the greeting", () => {
    expect(rendered.html).toContain("This month at the bakery");
    expect(rendered.html).toContain("display:none");
  });

  it("escapes anything that came from data before it reaches HTML", () => {
    const nasty = renderCampaign({
      campaign: { ...CAMPAIGN, body: "Hi {first_name}, <script>alert(1)</script>" },
      recipient: {
        email: "a@b.co",
        name: "<img src=x onerror=alert(1)> Evil",
      },
      workspaceName: "<b>Bakery</b>",
      unsubscribeUrl: "https://postbox.help/u/x",
      brand: NO_BRAND,
      sender: SENDER,
    });
    expect(nasty.html).not.toContain("<script>");
    expect(nasty.html).toContain("&lt;script&gt;");
    expect(nasty.html).not.toContain("onerror=alert(1)>");
  });

  it("is deterministic — the composer preview and the send path agree", () => {
    const again = renderCampaign({
      campaign: CAMPAIGN,
      recipient: { email: "alex@example.com", name: "Alex Fenton" },
      workspaceName: "Bramble Bakery",
      unsubscribeUrl: "https://postbox.help/u/tok123",
      brand: NO_BRAND,
      sender: SENDER,
    });
    expect(again).toEqual(rendered);
  });
});

// ── Unsubscribe plumbing ─────────────────────────────────────────

describe("unsubscribe", () => {
  it("builds a URL from a passed-in app URL, never a config import", () => {
    expect(unsubscribeUrl("https://postbox.help", "tok")).toBe(
      "https://postbox.help/u/tok",
    );
    // A trailing slash in the env value must not produce a double slash.
    expect(unsubscribeUrl("https://postbox.help/", "tok")).toBe(
      "https://postbox.help/u/tok",
    );
  });

  it("sets List-Unsubscribe-Post so the HTTPS entry is genuinely one-click", () => {
    const h = listUnsubscribeHeaders({
      url: "https://postbox.help/u/tok",
      mailto: "unsubscribe@news.postbox.help",
    });
    expect(h["List-Unsubscribe"]).toBe(
      "<mailto:unsubscribe@news.postbox.help>, <https://postbox.help/u/tok>",
    );
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("omits the mailto entirely rather than naming an unmonitored mailbox", () => {
    const h = listUnsubscribeHeaders({
      url: "https://postbox.help/u/tok",
      mailto: null,
    });
    expect(h["List-Unsubscribe"]).toBe("<https://postbox.help/u/tok>");
  });
});

// ── Input validation ─────────────────────────────────────────────

describe("campaign input", () => {
  const good = {
    name: "August newsletter",
    subject: "News from {company}",
    body: "Hi {first_name},",
  };

  it("accepts a minimal draft and defaults the template", () => {
    const r = parseCampaignInput(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.templateKey).toBe("plain");
      expect(r.value.listId).toBeNull();
      expect(r.value.preheader).toBeNull();
    }
  });

  it("rejects missing name, subject or body", () => {
    expect(parseCampaignInput({ ...good, name: "  " }).ok).toBe(false);
    expect(parseCampaignInput({ ...good, subject: "" }).ok).toBe(false);
    expect(parseCampaignInput({ ...good, body: "\n\n" }).ok).toBe(false);
  });

  it("rejects an unknown template key and a non-integer list id", () => {
    expect(parseCampaignInput({ ...good, templateKey: "fancy" }).ok).toBe(false);
    expect(parseCampaignInput({ ...good, listId: "abc" }).ok).toBe(false);
    expect(parseCampaignInput({ ...good, listId: 0 }).ok).toBe(false);
    expect(parseCampaignInput({ ...good, listId: 4 }).ok).toBe(true);
  });

  it("knows its template keys", () => {
    expect(isTemplateKey("plain")).toBe(true);
    expect(isTemplateKey("branded")).toBe(true);
    expect(isTemplateKey("nope")).toBe(false);
  });

  it("collapses whitespace in single-line fields but keeps the body intact", () => {
    const r = parseCampaignInput({
      ...good,
      name: "  August   newsletter  ",
      body: "Line one\n\nLine two",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("August newsletter");
      expect(r.value.body).toBe("Line one\n\nLine two");
    }
  });
});

// ── Address canonicalisation ─────────────────────────────────────

describe("email normalisation", () => {
  it("lower-cases and trims", () => {
    expect(normaliseEmail("  Bob@Example.COM ")).toBe("bob@example.com");
  });

  it("does NOT strip plus-tags or dots", () => {
    // Folding these would merge two distinct mailboxes: in a suppression check
    // that means mailing someone who asked us not to.
    expect(normaliseEmail("bob+news@example.com")).toBe("bob+news@example.com");
    expect(normaliseEmail("bob.smith@example.com")).toBe(
      "bob.smith@example.com",
    );
  });
});

// ── CAN-SPAM identification block ────────────────────────────────

/**
 * The postal address is the one field in a marketing email that a statute
 * names directly. The schema keeps it nullable rather than defaulting it,
 * because a fake address is an affirmative falsehood where a missing one is
 * merely an omission — so the whole design is "refuse to send", not "send
 * something".
 *
 * These tests exist to stop that being softened later by someone who reads the
 * throw as an inconvenience.
 */
describe("sender identity", () => {
  const render = (sender: {
    workspaceName: string;
    legalName: string | null;
    postalAddress: string | null;
  }) =>
    renderCampaign({
      campaign: CAMPAIGN,
      recipient: { email: "a@b.co", name: "Alex" },
      workspaceName: sender.workspaceName,
      unsubscribeUrl: "https://postbox.help/u/t",
      brand: NO_BRAND,
      sender,
    });

  it("puts the address in BOTH parts, beside the unsubscribe link", () => {
    const out = render(SENDER);
    expect(out.text).toContain("12 High Street");
    expect(out.text).toContain("HG1 1AA");
    expect(out.html).toContain("12 High Street");
    expect(out.html).toContain("HG1 1AA");
  });

  it("normalises a multi-line address onto one line", () => {
    // Clients paste addresses as they would write them on an envelope. Left
    // alone, that reads as body copy at the foot of the email rather than as
    // an address.
    expect(render(SENDER).text).toContain(
      "Bramble Bakery Ltd, 12 High Street, Harrogate, HG1 1AA",
    );
  });

  it("falls back to the workspace name when no legal name is recorded", () => {
    // A presentation fallback, not an invention: the workspace name is what
    // the client typed for themselves and is already the From name.
    const out = render({ ...SENDER, legalName: null });
    expect(out.text).toContain("Bramble Bakery, 12 High Street");
  });

  it("REFUSES to render without a postal address", () => {
    // Not a warning, not a placeholder, not an empty line. If this ever
    // becomes a soft failure, every campaign from a workspace that skipped the
    // settings screen goes out unlawfully and nothing says so.
    expect(() => render({ ...SENDER, postalAddress: null })).toThrow(
      /postal address/i,
    );
    expect(() => render({ ...SENDER, postalAddress: "   " })).toThrow(
      /postal address/i,
    );
  });

  it("escapes the address before it reaches HTML", () => {
    const out = render({
      ...SENDER,
      legalName: "<script>alert(1)</script>",
      postalAddress: "1 <b>Evil</b> Road",
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).not.toContain("<b>Evil</b>");
  });

  describe("mailableSender — the gate", () => {
    it("passes a workspace with an address", () => {
      expect(mailableSender(SENDER)).not.toBeNull();
    });

    it.each([
      ["null", null],
      ["empty", ""],
      ["whitespace", "   \n  "],
    ])("blocks a %s address", (_label, postalAddress) => {
      expect(mailableSender({ ...SENDER, postalAddress })).toBeNull();
    });

    it("does not care about the legal name", () => {
      // Only the address is statutory. Requiring both would block a workspace
      // that is perfectly able to send lawfully.
      expect(mailableSender({ ...SENDER, legalName: null })).not.toBeNull();
    });
  });
});
