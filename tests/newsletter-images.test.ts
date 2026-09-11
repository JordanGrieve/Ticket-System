import { describe, it, expect } from "vitest";
import { renderCampaign, safeImageUrl, NO_BRAND } from "../lib/newsletter";

/**
 * Images in campaign email.
 *
 * The URL half is the part with teeth: it becomes an `src` in mail we send on
 * a client's behalf, to their customers, and we never fetch it ourselves so
 * nothing downstream would catch a bad one.
 */

describe("which image URLs are allowed", () => {
  it("accepts an ordinary https URL", () => {
    expect(safeImageUrl("https://shop.example.com/bread.jpg")).toBe(
      "https://shop.example.com/bread.jpg",
    );
    expect(safeImageUrl("  https://a.example/b.png  ")).toBe("https://a.example/b.png");
  });

  it("refuses anything that is not https", () => {
    // http is refused as well as the dangerous schemes: a mixed-content image
    // is blocked by some clients and is a downgrade of the client's own site.
    for (const bad of [
      "http://example.com/a.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
      "file:///etc/passwd",
      "ftp://example.com/a.jpg",
      "//example.com/a.jpg",
    ]) {
      expect(safeImageUrl(bad), bad).toBeNull();
    }
  });

  it("refuses credentials in the URL", () => {
    // https://trusted.com@evil.io is a phishing shape, and no image host
    // needs a username.
    expect(safeImageUrl("https://user:pw@evil.example/a.jpg")).toBeNull();
    expect(safeImageUrl("https://trusted.example@evil.example/a.jpg")).toBeNull();
  });

  it("refuses nothing, rubbish and the absurdly long", () => {
    expect(safeImageUrl(null)).toBeNull();
    expect(safeImageUrl(undefined)).toBeNull();
    expect(safeImageUrl("")).toBeNull();
    expect(safeImageUrl("   ")).toBeNull();
    expect(safeImageUrl("not a url")).toBeNull();
    expect(safeImageUrl("https://e.com/" + "a".repeat(2100))).toBeNull();
  });
});

describe("rendering the hero image", () => {
  const base = {
    campaign: {
      subject: "This week",
      preheader: null,
      templateKey: "branded",
      body: "Hi {first_name},\n\nSomething new.",
    },
    recipient: { email: "a@b.com", name: "Alex" },
    workspaceName: "Open Door Bakery",
    unsubscribeUrl: "https://postbox.help/u/tok",
    sender: {
      workspaceName: "Open Door Bakery",
      legalName: "Open Door Bakery Ltd",
      postalAddress: "12 High Street, Harrogate",
    },
    brand: NO_BRAND,
  };

  it("puts the image above the body, with its alt text", () => {
    const out = renderCampaign({
      ...base,
      hero: { url: "https://shop.example.com/bread.jpg", alt: "A tray of sourdough" },
    });
    expect(out.html).toContain('src="https://shop.example.com/bread.jpg"');
    expect(out.html).toContain('alt="A tray of sourdough"');
    expect(out.html.indexOf("bread.jpg")).toBeLessThan(out.html.indexOf("Something new"));
  });

  it("carries a width attribute, not only a style", () => {
    // Outlook ignores max-width and would render a 3000px photo at 3000px.
    const out = renderCampaign({
      ...base,
      hero: { url: "https://e.com/a.jpg", alt: "x" },
    });
    expect(out.html).toMatch(/<img[^>]+width="\d+"/);
    expect(out.html).toMatch(/display:block/);
  });

  it("escapes the alt text", () => {
    // The alt is authored by the client and lands in an attribute.
    const out = renderCampaign({
      ...base,
      hero: { url: "https://e.com/a.jpg", alt: '"><script>alert(1)</script>' },
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&quot;");
  });

  it("renders nothing at all without one", () => {
    const without = renderCampaign(base);
    const withNull = renderCampaign({ ...base, hero: null });
    expect(without.html).not.toContain("<img");
    expect(withNull.html).toBe(without.html);
  });

  it("leaves the plain-text part alone", () => {
    // There is no text representation of a picture. The alt belongs in the
    // HTML; putting it in the text part would read as a stray caption.
    const out = renderCampaign({
      ...base,
      hero: { url: "https://e.com/a.jpg", alt: "A tray of sourdough" },
    });
    expect(out.text).not.toContain("A tray of sourdough");
    expect(out.text).not.toContain("e.com/a.jpg");
  });
});
