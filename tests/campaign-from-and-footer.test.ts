import { describe, it, expect } from "vitest";
import { campaignFromHeader, renderCampaign, NO_BRAND } from "../lib/newsletter";

/**
 * The two lines every recipient reads whether or not they open the email: who
 * it is from, and who it says sent it.
 *
 * ── BOTH WERE WRONG IN THE FIRST REAL CAMPAIGN ──
 * AMORIA's first send, 14 Sep 2026, arrived in Gmail from "newsletter" and
 * carried the footer "AMORIA, 12 High Street,, Edinburgh,, EH13 9LN".
 *
 *   • The From was `CAMPAIGN_FROM_ADDRESS` passed to the deliverer verbatim —
 *     one address for the entire platform, so every client's newsletter
 *     arrived from us rather than from the shop the reader subscribed to. That
 *     is the sender line, on a shared domain, where an unrecognised name is
 *     what gets a message reported.
 *
 *   • The double comma is the CAN-SPAM identification block, the one part of a
 *     marketing email the law is specific about, rendered by a joiner that
 *     added ", " to lines a person had already ended with a comma. It looked
 *     like a string-handling bug because it was one.
 *
 * Neither would have failed a build, a type check or any test that existed.
 * Both are visible in a screenshot of an inbox, which is how they were found.
 */

const SENDER = {
  workspaceName: "AMORIA",
  legalName: "AMORIA Ltd",
  postalAddress: "12 High Street,\nEdinburgh,\nEH13 9LN",
};

function footerOf(sender: typeof SENDER): string {
  return renderCampaign({
    campaign: {
      subject: "Hello",
      body: "Hi {first_name},\n\nSomething new.",
      preheader: null,
      templateKey: "plain",
    },
    recipient: { email: "sam@example.com", name: null },
    workspaceName: sender.workspaceName,
    unsubscribeUrl: "https://postbox.help/u/tok",
    sender,
    brand: NO_BRAND,
    hero: null,
    products: [],
  }).text;
}

describe("the address a client typed comes out as an address", () => {
  it("does not double the commas the client ended their lines with", () => {
    // Exactly what AMORIA typed, and exactly what went out.
    expect(footerOf(SENDER)).toContain("AMORIA Ltd, 12 High Street, Edinburgh, EH13 9LN");
    expect(footerOf(SENDER)).not.toContain(",,");
  });

  it("still joins lines that carry no punctuation at all", () => {
    const out = footerOf({
      ...SENDER,
      postalAddress: "12 High Street\nEdinburgh\nEH13 9LN",
    });
    expect(out).toContain("12 High Street, Edinburgh, EH13 9LN");
  });

  it("leaves punctuation INSIDE a line alone", () => {
    /*
     * Only a trailing separator goes. "Unit 4, The Mill" is one line of an
     * address and the comma in the middle of it is the client's, not ours —
     * stripping punctuation generally would quietly rewrite what somebody
     * wrote about where they are.
     */
    const out = footerOf({
      ...SENDER,
      postalAddress: "Unit 4, The Mill,\nEdinburgh",
    });
    expect(out).toContain("Unit 4, The Mill, Edinburgh");
  });

  it("does not leave a stray separator when a line is only punctuation", () => {
    const out = footerOf({ ...SENDER, postalAddress: "12 High Street\n,\nEdinburgh" });
    expect(out).not.toContain(", ,");
  });
});

describe("the From line carries the client, not the platform", () => {
  const ADDRESS = "newsletter@news.postbox.help";

  it("puts the workspace name in front of the shared address", () => {
    expect(campaignFromHeader("AMORIA", ADDRESS)).toBe(`AMORIA <${ADDRESS}>`);
  });

  it("does not change the address itself", () => {
    /*
     * The reputation argument for a separate marketing subdomain rests on the
     * ADDRESS, and it is verified with the provider. A display name is
     * cosmetic; changing the envelope would not be.
     */
    for (const name of ["AMORIA", "Smith, Baker & Co", "", "  "]) {
      const header = campaignFromHeader(name, ADDRESS);
      // The address it would actually be sent from: inside the brackets when
      // there is a display name, the whole string when there is not.
      const sentFrom = /<([^>]+)>/.exec(header)?.[1] ?? header;
      expect(sentFrom, `name "${name}" changed the envelope`).toBe(ADDRESS);
    }
  });

  it("quotes a name containing a comma, or the header becomes two addresses", () => {
    // "Smith, Baker & Co" unquoted parses as a recipient list. An ordinary
    // business name, not a contrived one.
    const header = campaignFromHeader("Smith, Baker & Co", ADDRESS);
    expect(header).toBe(`"Smith, Baker & Co" <${ADDRESS}>`);
  });

  it("escapes a quote inside the name rather than closing the string early", () => {
    const header = campaignFromHeader('The "Good" Shop', ADDRESS);
    expect(header).toBe(`"The \\"Good\\" Shop" <${ADDRESS}>`);
  });

  it("falls back to the bare address when there is no name", () => {
    expect(campaignFromHeader("", ADDRESS)).toBe(ADDRESS);
    expect(campaignFromHeader("   ", ADDRESS)).toBe(ADDRESS);
  });

  it("does not wrap an address that already has a display name", () => {
    /*
     * CAMPAIGN_FROM_ADDRESS may be configured as `Postbox <news@…>`. Wrapping
     * that again yields `AMORIA <Postbox <news@…>>`, which is not an address
     * and would be rejected — by the provider if we are lucky, by the
     * recipient's server if we are not.
     */
    expect(campaignFromHeader("AMORIA", `Postbox <${ADDRESS}>`)).toBe(
      `AMORIA <${ADDRESS}>`,
    );
  });
});
