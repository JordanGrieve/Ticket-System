import { describe, it, expect } from "vitest";
import {
  MAX_PRODUCTS,
  NO_BRAND,
  parseProducts,
  renderCampaign,
  safeImageUrl,
  sanitiseStoredProducts,
} from "../lib/newsletter";

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

describe("the products grid", () => {
  const base = {
    campaign: {
      subject: "This week",
      preheader: null,
      templateKey: "branded",
      body: "Hi {first_name},\n\nFresh in.",
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

  const sourdough = {
    name: "Sourdough loaf",
    imageUrl: "https://shop.example.com/sd.jpg",
    price: "£4.50",
    url: "https://shop.example.com/sourdough",
  };

  it("puts every product in the HTML and in the TEXT", () => {
    // The difference from the hero image, and the point of productsText: a
    // name and a price are facts the message is about, so a reader on a
    // text-only client must get them.
    const out = renderCampaign({ ...base, products: [sourdough] });
    expect(out.html).toContain("Sourdough loaf");
    expect(out.html).toContain("£4.50");
    expect(out.text).toContain("Sourdough loaf — £4.50");
    expect(out.text).toContain("https://shop.example.com/sourdough");
  });

  it("makes the name the link, rather than adding a second one", () => {
    const out = renderCampaign({ ...base, products: [sourdough] });
    expect(out.html).toContain('href="https://shop.example.com/sourdough"');
    expect(out.html).not.toMatch(/>\s*Buy\s*</i);
  });

  it("renders a product with no image and no price", () => {
    const out = renderCampaign({
      ...base,
      products: [{ name: "Tasting box", imageUrl: null, price: null, url: null }],
    });
    expect(out.html).toContain("Tasting box");
    expect(out.text).toContain("Tasting box");
  });

  it("leaves the last cell empty on an odd count", () => {
    // A lone product stretched across the row reads as a mistake.
    const out = renderCampaign({
      ...base,
      products: [sourdough, { ...sourdough, name: "Buns" }, { ...sourdough, name: "Focaccia" }],
    });
    const rows = out.html.match(/<tr>/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(out.html).toContain("&nbsp;");
  });

  it("escapes every authored field", () => {
    const out = renderCampaign({
      ...base,
      products: [
        {
          name: '"><script>alert(1)</script>',
          imageUrl: null,
          price: "<b>£1</b>",
          url: null,
        },
      ],
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<b>£1</b>");
  });

  it("renders nothing when there are none", () => {
    const without = renderCampaign(base);
    const empty = renderCampaign({ ...base, products: [] });
    expect(empty.html).toBe(without.html);
    expect(empty.text).toBe(without.text);
  });
});

describe("validating submitted products", () => {
  it("accepts a well-formed list", () => {
    const r = parseProducts([
      { name: "Loaf", imageUrl: "https://e.com/a.jpg", price: "£4", url: "https://e.com/buy" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value).toHaveLength(1);
    expect(r.value[0]!.name).toBe("Loaf");
  });

  it("treats absent and empty as no products", () => {
    for (const input of [undefined, null, []]) {
      const r = parseProducts(input);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("unreachable");
      expect(r.value).toEqual([]);
    }
  });

  it("SKIPS a nameless row rather than refusing the save", () => {
    // That is how a blank form row reaches here, and refusing to save a
    // campaign because of an empty field the composer left on screen for the
    // next entry would be maddening.
    const r = parseProducts([{ name: "  " }, { name: "Loaf" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value).toHaveLength(1);
  });

  it("REFUSES a bad link rather than dropping it", () => {
    // The opposite choice from a nameless row, and for the opposite reason:
    // the client typed something and meant it, so silence would teach nothing.
    const bad = parseProducts([
      { name: "Loaf", imageUrl: "http://insecure.example/a.jpg" },
    ]);
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("unreachable");
    expect(bad.error).toContain("Loaf");
    expect(bad.error).toContain("https://");

    const badLink = parseProducts([{ name: "Loaf", url: "javascript:alert(1)" }]);
    expect(badLink.ok).toBe(false);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_PRODUCTS + 1 }, (_, i) => ({ name: `P${i}` }));
    const r = parseProducts(many);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain(String(MAX_PRODUCTS));
  });

  it("refuses something that is not a list at all", () => {
    expect(parseProducts("nope").ok).toBe(false);
    expect(parseProducts({ name: "Loaf" }).ok).toBe(false);
    expect(parseProducts([1, 2]).ok).toBe(false);
  });
});

/**
 * The stored-row path, which is NOT the submitted-row path.
 *
 * parseProducts refuses a bad link because a person is looking at a form.
 * sanitiseStoredProducts drops one, because by the time it runs the campaign
 * is already going out and nobody is there to fix it. Getting these the wrong
 * way round would mean either a send that dies on one typo, or a typo that
 * reaches forty thousand inboxes as an href.
 */
describe("re-checking stored products at send time", () => {
  it("keeps a good row untouched", () => {
    expect(
      sanitiseStoredProducts([
        {
          name: "Sourdough loaf",
          imageUrl: "https://shop.example.com/sd.jpg",
          price: "£4.50",
          url: "https://shop.example.com/sourdough",
        },
      ]),
    ).toEqual([
      {
        name: "Sourdough loaf",
        imageUrl: "https://shop.example.com/sd.jpg",
        price: "£4.50",
        url: "https://shop.example.com/sourdough",
      },
    ]);
  });

  it("drops an unusable link rather than refusing the send", () => {
    const out = sanitiseStoredProducts([
      {
        name: "Sourdough loaf",
        imageUrl: "javascript:alert(1)",
        price: "£4.50",
        url: "http://shop.example.com/sourdough",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Sourdough loaf");
    expect(out[0]!.imageUrl).toBeNull();
    expect(out[0]!.url).toBeNull();
    expect(out[0]!.price).toBe("£4.50");
  });

  it("drops a nameless row and anything that is not an object", () => {
    expect(sanitiseStoredProducts([{ name: "  " }, "nope", null, 7])).toEqual([]);
  });

  it("answers with nothing when the column holds something that is not a list", () => {
    expect(sanitiseStoredProducts(null)).toEqual([]);
    expect(sanitiseStoredProducts({ name: "Loaf" })).toEqual([]);
  });

  it("stops at the maximum however many the column holds", () => {
    const many = Array.from({ length: MAX_PRODUCTS + 5 }, (_, i) => ({
      name: `Item ${i}`,
      imageUrl: null,
      price: null,
      url: null,
    }));
    expect(sanitiseStoredProducts(many)).toHaveLength(MAX_PRODUCTS);
  });
});

describe("the email head", () => {
  it("declares a charset, so £ and curly quotes survive", () => {
    // Missing until 11 Sep 2026. Most clients guess UTF-8 correctly; the
    // guess fails on exactly the characters a British bakery writes.
    const out = renderCampaign({
      campaign: { subject: "x", preheader: null, templateKey: "branded", body: "£5 — we're open" },
      recipient: { email: "a@b.com", name: null },
      workspaceName: "W",
      unsubscribeUrl: "https://postbox.help/u/t",
      sender: { workspaceName: "W", legalName: "W Ltd", postalAddress: "1 A Street" },
      brand: NO_BRAND,
    });
    expect(out.html).toContain('<meta charset="utf-8"');
    expect(out.html).toContain("width=device-width");
  });

  it("carries the rule that stacks the grid on a phone", () => {
    const out = renderCampaign({
      campaign: { subject: "x", preheader: null, templateKey: "plain", body: "hi" },
      recipient: { email: "a@b.com", name: null },
      workspaceName: "W",
      unsubscribeUrl: "https://postbox.help/u/t",
      sender: { workspaceName: "W", legalName: "W Ltd", postalAddress: "1 A Street" },
      brand: NO_BRAND,
    });
    expect(out.html).toContain("max-width: 480px");
    expect(out.html).toContain(".pb-col");
  });
});
