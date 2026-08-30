import { describe, it, expect } from "vitest";
import {
  STARTER_CAMPAIGN_BODY,
  unfilledSlots,
  NEWSLETTER_MERGE_TOKENS,
  renderTemplate,
  buildCampaignMergeValues,
} from "../lib/newsletter";
import { STARTER_LABELS } from "../lib/starter-labels";
import type { LabelColor } from "../db/schema";

/*
 * lib/labels.ts owns isLabelColor but is `server-only` — it imports the
 * database, which throws at import time with no DATABASE_URL, which is the
 * whole reason CI cannot reach it. So the tokens are restated here and TYPED,
 * which is what does the work: remove or rename one in db/schema.ts and this
 * line stops compiling.
 */
const VALID_COLORS: LabelColor[] = ["tag_a", "tag_b", "tag_c"];

/**
 * Pre-written defaults where a blank field used to be (onboarding research,
 * item 2). A default turns creation into editing; the risk it introduces is
 * that the default itself gets sent.
 */

describe("the starter campaign body", () => {
  it("demonstrates the merge tokens rather than only listing them", () => {
    // The composer lists the tokens in a toolbar. This is the one surface
    // where somebody sees one resolve in the preview beside them.
    expect(STARTER_CAMPAIGN_BODY).toContain("{first_name}");
    expect(STARTER_CAMPAIGN_BODY).toContain("{company}");
  });

  it("uses only tokens that actually exist", () => {
    /*
     * renderTemplate DELETES unknown tokens rather than passing them through,
     * so a typo here would not error — it would silently ship a default with
     * a hole in it. This is the only thing that catches that.
     */
    const known = new Set(NEWSLETTER_MERGE_TOKENS.map((t) => t.name));
    const used = [...STARTER_CAMPAIGN_BODY.matchAll(/\{([a-z_]+)\}/g)].map(
      (m) => m[1]!,
    );
    expect(used.length).toBeGreaterThan(0);
    for (const token of used) expect(known).toContain(token);
  });

  it("renders to something a person could actually read", () => {
    const out = renderTemplate(
      STARTER_CAMPAIGN_BODY,
      buildCampaignMergeValues({
        name: "Alex Fenton",
        email: "alex@example.com",
        workspaceName: "Open Door Bakery",
        unsubscribeUrl: "https://postbox.help/u/t",
      }),
    );
    expect(out).toContain("Hi Alex,");
    expect(out).toContain("Open Door Bakery");
    expect(out).not.toContain("{");
  });

  it("is flagged as unfinished by the check that ships with it", () => {
    // The default MUST trip its own warning, or the warning is decoration.
    expect(unfilledSlots(STARTER_CAMPAIGN_BODY).length).toBeGreaterThan(0);
  });
});

describe("spotting placeholders somebody forgot", () => {
  it("finds each slot separately rather than swallowing the message", () => {
    const found = unfilledSlots("a [one] b [two] c");
    expect(found).toEqual(["[one]", "[two]"]);
  });

  it("does not run one match across two slots", () => {
    /*
     * A greedy pattern would match "[one] b [two]" as a single slot, which
     * would report "1 placeholder" for a body containing two — and quote a
     * chunk of the newsletter back at the author as though it were one.
     */
    const found = unfilledSlots("[one] b [two]");
    expect(found).toHaveLength(2);
  });

  it("says nothing about a finished newsletter", () => {
    expect(unfilledSlots("The sourdough is back. See you Saturday.")).toEqual(
      [],
    );
    expect(unfilledSlots("")).toEqual([]);
  });

  it("ignores empty and unclosed brackets", () => {
    expect(unfilledSlots("[]")).toEqual([]);
    expect(unfilledSlots("a [ b")).toEqual([]);
  });
});

describe("the starter label set", () => {
  it("offers a usable number of them", () => {
    // Long enough to be a filing system, short enough to read in one go.
    expect(STARTER_LABELS.length).toBeGreaterThanOrEqual(3);
    expect(STARTER_LABELS.length).toBeLessThanOrEqual(6);
  });

  it("carries colours the API will accept", () => {
    // These are POSTed straight to /api/labels, which rejects an unknown one
    // with a 400 — so a bad token here would be a button that simply fails.
    for (const label of STARTER_LABELS) {
      expect(VALID_COLORS).toContain(label.color);
      expect(label.name.trim()).toBe(label.name);
      expect(label.name.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate names", () => {
    // (workspace_id, name) is unique, so a duplicate here would make the
    // button silently create fewer labels than it shows.
    const names = STARTER_LABELS.map((l) => l.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
