import { describe, it, expect } from "vitest";
import {
  renderCampaign,
  emailAccent,
  DEFAULT_EMAIL_ACCENT,
  NO_BRAND,
  type Brand,
} from "../lib/newsletter";
import { contrastRatio, parseHex, MIN_CONTRAST } from "../lib/email-colour";

/**
 * Per-workspace newsletter branding (PIVOT 42).
 *
 * The half of that task that does not need object storage: the accent colour
 * and the sign-off. The header logo is absent on purpose and there is nothing
 * here pretending otherwise.
 */

const SENDER = {
  workspaceName: "Bramble Bakery",
  legalName: "Bramble Bakery Ltd",
  postalAddress: "12 High Street\nHarrogate\nHG1 1AA",
};

function render(brand: Brand, templateKey = "branded") {
  return renderCampaign({
    campaign: {
      subject: "News from {company}",
      preheader: "This month",
      templateKey,
      body: "Hi {first_name},\n\nWe have new sourdough. https://bramble.example/shop",
    },
    recipient: { email: "alex@example.com", name: "Alex Fenton" },
    workspaceName: "Bramble Bakery",
    unsubscribeUrl: "https://postbox.help/u/tok123",
    sender: SENDER,
    brand,
  });
}

describe("the accent a message is actually sent with", () => {
  it("falls back to the Postbox default when nothing is chosen", () => {
    expect(emailAccent(null, "#ffffff")).toBe(DEFAULT_EMAIL_ACCENT);
  });

  it("ships a default that passes the same bar clients are held to", () => {
    // A default that failed its own contrast rule would be indefensible.
    const ratio = contrastRatio(
      parseHex(DEFAULT_EMAIL_ACCENT)!,
      parseHex("#ffffff")!,
    );
    expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("keeps a readable pick exactly as chosen", () => {
    expect(emailAccent("#1a5c9e", "#ffffff")).toBe("#1a5c9e");
  });

  it("darkens a pick that could not be read", () => {
    const out = emailAccent("#ffe94a", "#ffffff");
    expect(out).not.toBe("#ffe94a");
    expect(
      contrastRatio(parseHex(out)!, parseHex("#ffffff")!),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("treats junk as 'nothing chosen' rather than emitting it", () => {
    /*
     * This value reaches a `style` attribute. The API validates on the way in,
     * but the renderer is what actually protects the message — a row written
     * before that validation existed, or by a script, must not be able to put
     * arbitrary text into the HTML.
     */
    for (const junk of [
      "red",
      "javascript:alert(1)",
      "#ff0000; background: url(x)",
      "",
      "#gg0000",
    ]) {
      expect(emailAccent(junk, "#ffffff")).toBe(DEFAULT_EMAIL_ACCENT);
    }
  });
});

describe("what comes out of the renderer", () => {
  it("paints body links and the unsubscribe link in the accent", () => {
    const { html } = render({ accentHex: "#1a5c9e", signOff: null });
    expect(html).toContain('style="color:#1a5c9e;"');
    expect(html).toContain("color:#1a5c9e;text-decoration:underline;");
  });

  it("never writes an unreadable colour into the markup", () => {
    const { html } = render({ accentHex: "#ffe94a", signOff: null });
    expect(html).not.toContain("#ffe94a");
  });

  it("draws the masthead rule only on the branded template", () => {
    const branded = render({ accentHex: "#1a5c9e", signOff: null }, "branded");
    const plain = render({ accentHex: "#1a5c9e", signOff: null }, "plain");
    expect(branded.html).toContain("background:#1a5c9e");
    expect(plain.html).not.toContain("background:#1a5c9e");
  });

  it("puts the sign-off in BOTH parts, above the unsubscribe line", () => {
    const { text, html } = render({
      accentHex: null,
      signOff: "— Emma, Bramble Bakery",
    });
    expect(text).toContain("— Emma, Bramble Bakery");
    expect(html).toContain("— Emma, Bramble Bakery");
    // Order matters: the message should end with a person, then the small print.
    expect(text.indexOf("— Emma")).toBeLessThan(text.indexOf("Unsubscribe"));
    expect(html.indexOf("— Emma")).toBeLessThan(html.indexOf("Unsubscribe"));
  });

  it("adds nothing at all when there is no sign-off", () => {
    const withOut = render(NO_BRAND);
    expect(withOut.text).not.toMatch(/\n\n\n/);
    expect(withOut.html).not.toContain("margin:22px 0 0");
  });

  it("escapes a sign-off, because a client typed it", () => {
    const { html } = render({
      accentHex: null,
      signOff: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("branding cannot break the things that are not optional", () => {
  /*
   * The rule from db/schema.ts, asserted rather than trusted: identity stops a
   * send, branding never does. Everything below renders with the most hostile
   * branding available and must still produce a lawful message.
   */
  const hostile: Brand = {
    accentHex: "not a colour",
    signOff: "   ",
  };

  it("still renders with branding that is entirely rubbish", () => {
    const { html, text } = render(hostile);
    expect(html).toContain(DEFAULT_EMAIL_ACCENT);
    expect(text.length).toBeGreaterThan(0);
  });

  it("still carries the unsubscribe link in both parts", () => {
    const { html, text } = render(hostile);
    expect(text).toContain("https://postbox.help/u/tok123");
    expect(html).toContain("https://postbox.help/u/tok123");
  });

  it("still carries the postal address in both parts", () => {
    const { html, text } = render(hostile);
    expect(text).toContain("12 High Street");
    expect(html).toContain("12 High Street");
    expect(text).toContain("Bramble Bakery Ltd");
  });

  it("still refuses when the POSTAL ADDRESS is missing, branding or not", () => {
    // The one thing that must keep throwing. Branding must not rescue it.
    expect(() =>
      renderCampaign({
        campaign: {
          subject: "s",
          preheader: null,
          templateKey: "branded",
          body: "b",
        },
        recipient: { email: "a@example.com", name: null },
        workspaceName: "Bramble Bakery",
        unsubscribeUrl: "https://postbox.help/u/t",
        sender: { ...SENDER, postalAddress: null },
        brand: { accentHex: "#1a5c9e", signOff: "— Emma" },
      }),
    ).toThrow(/postal address/i);
  });
});
