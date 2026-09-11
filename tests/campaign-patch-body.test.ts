import { describe, it, expect } from "vitest";
import {
  campaignPatchBody,
  parseCampaignInput,
  type CampaignDraftInput,
} from "../lib/newsletter";

/**
 * Editing a draft must not throw away the parts of it you did not touch.
 *
 * ── WHAT THIS IS GUARDING ──
 * PATCH /api/campaigns/:id validates the campaign as a WHOLE — unspecified
 * fields fall back to what is stored — so whatever comes out of this function
 * is what gets written. On 11 September 2026 the fallback was a literal at
 * the route listing six of the nine fields, and every save of a draft wiped
 * its hero image and its products. Not a crash, not a 400: a successful save
 * that returned a campaign with the work removed, which the composer then
 * drew.
 *
 * It happened even when the composer sent them, because the route never read
 * those keys and "no image, no products" is a perfectly valid campaign.
 */

const stored: CampaignDraftInput = {
  name: "September specials",
  subject: "This month at the bakery",
  preheader: "Sourdough is back on Thursdays",
  templateKey: "branded",
  body: "Hi {first_name},\n\nFresh in.",
  listId: null,
  heroImageUrl: "https://shop.example.com/hero.jpg",
  heroImageAlt: "A tray of sourdough",
  products: [
    {
      name: "Sourdough loaf",
      imageUrl: "https://shop.example.com/sd.jpg",
      price: "£4.50",
      url: "https://shop.example.com/sourdough",
    },
  ],
};

describe("a partial edit keeps what it did not mention", () => {
  it("keeps the image and the products when the body omits them", () => {
    // The exact shape the composer used to send before it learned to include
    // them — and the shape any other client of this API would send.
    const out = campaignPatchBody({ subject: "A new subject" }, stored);
    expect(out.subject).toBe("A new subject");
    expect(out.heroImageUrl).toBe("https://shop.example.com/hero.jpg");
    expect(out.heroImageAlt).toBe("A tray of sourdough");
    expect(out.products).toEqual(stored.products);
  });

  it("keeps every other field too", () => {
    const out = campaignPatchBody({ name: "Renamed" }, stored);
    expect(out.name).toBe("Renamed");
    expect(out.subject).toBe(stored.subject);
    expect(out.preheader).toBe(stored.preheader);
    expect(out.templateKey).toBe(stored.templateKey);
    expect(out.body).toBe(stored.body);
    expect(out.listId).toBe(stored.listId);
  });

  it("takes what the body DOES say, including emptying something", () => {
    // Clearing has to be possible: this is how a client removes an image or
    // the last product, and a fallback that treated null as "not supplied"
    // would make both unremovable.
    const out = campaignPatchBody(
      { heroImageUrl: null, heroImageAlt: null, products: [] },
      stored,
    );
    expect(out.heroImageUrl).toBeNull();
    expect(out.heroImageAlt).toBeNull();
    expect(out.products).toEqual([]);
  });

  it("survives the round trip through the validator", () => {
    // campaignPatchBody's output is not written directly — it is validated
    // first, and the validator is what a wrong shape would fail on.
    const parsed = parseCampaignInput(campaignPatchBody({ subject: "Edited" }, stored));
    expect(parsed.ok, "the patch body did not validate").toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.subject).toBe("Edited");
    expect(parsed.value.heroImageUrl).toBe("https://shop.example.com/hero.jpg");
    expect(parsed.value.products).toHaveLength(1);
    expect(parsed.value.products[0]!.name).toBe("Sourdough loaf");
  });

  it("answers with every field of a draft input, whatever the body carried", () => {
    /*
     * The structural half. `satisfies Record<keyof CampaignDraftInput,
     * unknown>` in the function makes a missing key a compile error; this
     * asserts the same thing at runtime for the benefit of anyone reading the
     * test to find out what a patch actually writes.
     */
    const out = campaignPatchBody({}, stored);
    expect(Object.keys(out).sort()).toEqual(Object.keys(stored).sort());
  });
});
