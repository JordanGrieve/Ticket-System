import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAMPAIGN_NAME_MAX,
  copyCampaignName,
  parseCampaignInput,
} from "../lib/newsletter";

/**
 * Duplicating a campaign.
 *
 * ── WHY IT EXISTS ──
 * A sent campaign is locked, correctly: the row is the record of what a
 * client's customers were told, and editing it would leave every recipient row
 * describing an email that never existed. But the lock had no way forward from
 * it, so "send that again with one word changed" meant retyping the whole
 * thing. Jordan, 14 Sep 2026: "I can't resend another email if I change it?
 * Why is it locked?"
 *
 * ── THE FAILURE THIS GUARDS ──
 * A copy that quietly drops a field. It has happened twice in this file's
 * neighbourhood — createCampaign once listed six of nine fields and dropped a
 * client's hero image and products on the very first save, and the test-send
 * route rendered without either. Neither was a type error. The copy is built
 * through `draftColumns`, whose `satisfies Record<keyof CampaignDraftInput,
 * unknown>` makes a forgotten field a compile error, and the source guard
 * below is what keeps it built that way.
 */

const LIB = readFileSync(join(process.cwd(), "lib/campaign-send.ts"), "utf8");

/** duplicateCampaign's body, bounded by the next top-level declaration. */
function duplicateSource(): string {
  const at = LIB.indexOf("export async function duplicateCampaign");
  expect(at, "duplicateCampaign is gone — this file is reading nothing").
    toBeGreaterThan(-1);
  const end = LIB.indexOf("\n/**", at);
  return LIB.slice(at, end === -1 ? undefined : end);
}

describe("what a copy carries", () => {
  const body = duplicateSource();

  it("copies every piece of content the email is made of", () => {
    /*
     * Named individually rather than counted. A copy missing `products` is a
     * newsletter that silently loses its shop, and the person who notices is
     * the client, after sending.
     */
    for (const field of [
      "subject",
      "preheader",
      "templateKey",
      "body",
      "heroImageUrl",
      "heroImageAlt",
      "products",
    ]) {
      expect(body, `the copy does not carry ${field}`).toContain(`${field}:`);
    }
  });

  it("goes through createCampaign, so draftColumns' satisfies applies", () => {
    /*
     * The real guarantee. An insert written by hand here would compile with
     * eight of nine fields, exactly as createCampaign once did; routing
     * through it means the tenth field added tomorrow cannot be left out of a
     * copy without tsc stopping.
     */
    expect(body).toContain("createCampaign(");
    expect(body).not.toContain("db.insert(");
  });

  it("carries NO history — that belongs to the send that happened", () => {
    // A duplicate holding a status, a schedule, a sent time or the provider's
    // ids would be a second row claiming the first one's history.
    for (const field of [
      "status",
      "scheduledAt",
      "sentAt",
      "recipientCount",
      "providerMessageId",
    ]) {
      expect(body, `the copy carries ${field}, which describes the original send`).
        not.toContain(`${field}:`);
    }
  });

  it("re-validates the stored content instead of trusting the row", () => {
    // products is jsonb and templateKey is free text. A row written by an
    // older version of this code is exactly the one that reaches a renderer
    // nobody expected — same treatment the send path gives it.
    expect(body).toContain("sanitiseStoredProducts(");
    expect(body).toContain("safeImageUrl(");
    expect(body).toContain("isTemplateKey(");
  });

  it("is scoped to the workspace by reading through getCampaign", () => {
    // The id arrives in a URL. getCampaign takes the workspace as its first
    // argument and returns null for a campaign that is not theirs, which is
    // what makes the route's 404 a 404 rather than a leak.
    expect(body).toContain("getCampaign(workspaceId, campaignId)");
  });
});

describe("the name a copy gets", () => {
  /*
   * Run, not read. copyCampaignName lives in lib/newsletter.ts — the pure half
   * — precisely so these can be assertions about behaviour rather than a regex
   * matched against the source of a function nothing here can call.
   */

  /** The validator the composer itself uses. */
  function accepts(name: string): boolean {
    return parseCampaignInput({
      name,
      subject: "Subject",
      body: "Body",
      templateKey: "plain",
    }).ok;
  }

  it("marks the copy", () => {
    expect(copyCampaignName("Saturday hours")).toBe("Saturday hours (copy)");
  });

  it("does not stack suffixes when a copy is copied", () => {
    // The third attempt at a subject line is the normal case, and a naive
    // append reaches "Sale (copy) (copy) (copy)" by then.
    const once = copyCampaignName("Sale");
    const twice = copyCampaignName(once);
    const thrice = copyCampaignName(twice);
    expect(twice).toBe("Sale (copy)");
    expect(thrice).toBe("Sale (copy)");
  });

  it("produces a name the product will actually save", () => {
    /*
     * The one that would ship broken. A name already at the limit, suffixed,
     * is over it — and the validator that accepted the original then refuses
     * the copy, so the button appears to work and the next save fails.
     */
    const atLimit = "x".repeat(CAMPAIGN_NAME_MAX);
    expect(accepts(atLimit), "the fixture is not actually at the limit").toBe(true);

    const copied = copyCampaignName(atLimit);
    expect(copied.length).toBeLessThanOrEqual(CAMPAIGN_NAME_MAX);
    expect(copied.endsWith(" (copy)")).toBe(true);
    expect(accepts(copied), `"${copied}" cannot be saved`).toBe(true);
  });

  it("still names an untitled campaign something", () => {
    // `name` is notNull and a blank one exists — typed, then cleared. A copy
    // called " (copy)" is worse than one called "Untitled (copy)".
    expect(copyCampaignName("")).toBe("Untitled (copy)");
    expect(copyCampaignName("   ")).toBe("Untitled (copy)");
  });

  it("is what the duplicate actually uses", () => {
    // The seam between the tested function and the copy. Without this, all of
    // the above could be true of a function nothing calls.
    expect(duplicateSource()).toContain("copyCampaignName(source.name)");
  });
});
