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

  /*
   * ── ONE ANCHOR, WRAPPING EVERYTHING ──
   * The photo, the name and the price are inside a single <a>, so the whole
   * card opens the product rather than a ~90px line of text. Two things have
   * to hold and neither is visible in a rendered screenshot: the anchor must
   * CONTAIN the image and the price, and there must be exactly one of them —
   * a name-anchor inside a card-anchor is invalid HTML that clients resolve
   * however they like.
   */
  it("wraps the photo, the name and the price in one anchor", () => {
    const out = renderCampaign({ ...base, products: [sourdough] });
    const gridAt = out.html.indexOf('class="pb-grid"');
    const grid = out.html.slice(gridAt, out.html.indexOf("</table>", gridAt));

    const open = grid.indexOf("<a ");
    expect(open, "the card is not a link at all").toBeGreaterThan(-1);
    const card = grid.slice(open, grid.indexOf("</a>", open));
    expect(card, "the photo is outside the link").toContain("<img");
    expect(card, "the price is outside the link").toContain("£4.50");
    expect(card, "the name is outside the link").toContain("Sourdough loaf");

    expect(
      (grid.match(/<a /g) ?? []).length,
      "one product, one anchor — a nested link is invalid and resolves differently per client",
    ).toBe(1);
  });

  it("gives a product with no link the same box, not a smaller one", () => {
    const out = renderCampaign({
      ...base,
      products: [{ ...sourdough, url: null }],
    });
    const gridAt = out.html.indexOf('class="pb-grid"');
    const grid = out.html.slice(gridAt, out.html.indexOf("</table>", gridAt));
    expect(grid).not.toContain("<a ");
    expect(grid, "the card's border is what makes it read as a box").toContain(
      "border:1px solid #e7e1d6",
    );
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

  /*
   * ── THE PAIR HAS TO LINE UP ──
   * On the live site a product with no photo sat with its name at the top of
   * its cell while its neighbour's sat under a 180px image. Two things fix
   * it and BOTH have to hold, which is why they are asserted rather than
   * left to the eye: the cells are bottom-aligned, and every cell has the
   * same number of text lines whatever the product is missing.
   */
  it("bottom-aligns the cells so the text of a pair shares a baseline", () => {
    const out = renderCampaign({
      ...base,
      products: [sourdough, { name: "Cinnamon bun", imageUrl: null, price: null, url: null }],
    });
    const cells = out.html.match(/<td class="pb-col"[^>]*>/g) ?? [];
    expect(cells.length).toBe(2);
    for (const cell of cells) expect(cell).toContain('valign="bottom"');
  });

  /*
   * ── THE PHOTOS MUST NOT TOUCH ──
   * They did, in a real send on 11 Sep 2026. The gutter was a third <td> of
   * width 16 between two cells that each asked for 50%: that is 116% of the
   * row, and what a browser gives back is the spacer squeezed to nothing.
   * The images, being width:100% of their own cells, met in the middle.
   *
   * A spacer column cannot be trusted to survive, so there is none — the gap
   * is padding on each cell, which cannot be squeezed away. This asserts the
   * shape rather than the appearance, because nothing in CI renders an email.
   */
  it("puts the gap between the cells in padding, not a spacer column", () => {
    const out = renderCampaign({
      ...base,
      products: [sourdough, { ...sourdough, name: "Buns" }],
    });
    const cells = out.html.match(/<td class="pb-col"[^>]*>/g) ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[0]!, "the left cell needs a right-hand gutter").toContain(
      "padding:0 10px 18px 0;",
    );
    expect(cells[1]!, "the right cell needs a left-hand gutter").toContain(
      "padding:0 0 18px 10px;",
    );
    /*
     * The grid's own row holds the two product cells and nothing else.
     *
     * Sliced from `class="pb-grid"`, NOT from the first "<tr>" in the
     * message: the branded shell opens several tables of its own before the
     * grid, so the first version of this read the masthead's row and could
     * not fail. Caught by putting the spacer column back and watching it stay
     * green.
     */
    const gridAt = out.html.indexOf('class="pb-grid"');
    expect(gridAt, "no products grid in the rendered HTML").toBeGreaterThan(-1);
    const grid = out.html.slice(gridAt, out.html.indexOf("</table>", gridAt));
    expect(
      (grid.match(/<td/g) ?? []).length,
      "a third cell is a spacer column, and a spacer column is what collapsed",
    ).toBe(2);
  });

  it("stacks without the gutter, so a phone does not indent every other product", () => {
    const out = renderCampaign({ ...base, products: [sourdough] });
    const head = out.html.slice(0, out.html.indexOf("</head>"));
    expect(head).toContain("max-width: 480px");
    expect(head).toContain("padding-left: 0 !important");
  });

  it("sizes the photo to 216, in the attribute as well as the style", () => {
    // Outlook ignores max-width and lays out to the width ATTRIBUTE, so the
    // two have to agree or the grid is 236 wide in Outlook and 216 elsewhere.
    const out = renderCampaign({ ...base, products: [sourdough] });
    expect(out.html).toContain('width="216"');
    expect(out.html).toContain("max-width:216px");
    expect(out.html).not.toContain("236");
  });

  it("gives a product with no price the same two lines as one with a price", () => {
    const priced = renderCampaign({ ...base, products: [sourdough] });
    const free = renderCampaign({
      ...base,
      products: [{ ...sourdough, price: null }],
    });
    /*
     * The CONTENT of the price line, not merely its presence. The first
     * version of this counted the divs, and an empty div passed it happily —
     * which is the bug it was written to catch, since a div with nothing in
     * it has no line box and the cell is a line shorter than its neighbour
     * all the same. It has to be a non-breaking space.
     */
    const priceLine = (html: string) => {
      const m = html.match(/font:400 13px\/1\.4 Arial[^>]*>([^<]*)</);
      expect(m, "no price line in the rendered product").not.toBeNull();
      return m![1]!;
    };
    expect(priceLine(priced.html)).toBe("£4.50");
    expect(priceLine(free.html)).toBe("&nbsp;");
    // And the text part still says nothing about a price it does not have.
    // The em dash on its own line is the unsubscribe footer's rule, which is
    // why this looks at the product's line rather than the whole message.
    expect(free.text).toContain("Sourdough loaf");
    expect(free.text).not.toContain("Sourdough loaf —");
  });

  it("wraps the name in the same block whether or not it links", () => {
    // An inline <a> where the other cell has a <div> is a different line box,
    // which is the alignment bug in miniature.
    const linked = renderCampaign({ ...base, products: [sourdough] });
    const plain = renderCampaign({
      ...base,
      products: [{ ...sourdough, url: null }],
    });
    const nameDivs = (html: string) =>
      (html.match(/font:700 14px\/1\.4 Arial/g) ?? []).length;
    expect(nameDivs(linked.html)).toBe(1);
    expect(nameDivs(plain.html)).toBe(1);
    expect(linked.html).toContain('href="https://shop.example.com/sourdough"');
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
