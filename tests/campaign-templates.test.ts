import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_TEMPLATES,
  templateByKey,
} from "../lib/campaign-templates";
import { unfilledSlots } from "../lib/newsletter";

/**
 * The starting points a new campaign can be written from.
 *
 * Small surface, but two of these rules have teeth: a duplicate key would
 * light two chips at once, and a template whose slots do not look like slots
 * is a template somebody sends unedited.
 */

describe("the campaign templates", () => {
  it("has a blank start, and it is first", () => {
    // First because it is the status quo: the body every new campaign already
    // opened with before templates existed.
    expect(CAMPAIGN_TEMPLATES[0]?.key).toBe("blank");
  });

  it("has the one Jordan asked for", () => {
    expect(CAMPAIGN_TEMPLATES.map((t) => t.key)).toContain("next_drop");
  });

  it("has unique keys", () => {
    // The composer lights a chip on `key`, so a duplicate would light two.
    const keys = CAMPAIGN_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names every template and says what it is for", () => {
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(t.name.trim(), t.key).not.toBe("");
      expect(t.description.trim(), t.key).not.toBe("");
      expect(t.body.trim(), t.key).not.toBe("");
    }
  });

  it("leaves visible slots the composer will catch", () => {
    // Every template except the blank start carries bracketed slots, and the
    // readiness checklist refuses to send while any remain. A template whose
    // prose reads as finished is one somebody mails as-is.
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(unfilledSlots(t.body).length, t.key).toBeGreaterThan(0);
    }
  });

  it("only the blank start leaves the subject alone", () => {
    // An empty subject means "do not touch what is already typed". Every
    // other template replaces it, which is the point of choosing one.
    for (const t of CAMPAIGN_TEMPLATES) {
      if (t.key === "blank") expect(t.subject).toBe("");
      else expect(t.subject.trim(), t.key).not.toBe("");
    }
  });

  it("uses merge tags that actually resolve", () => {
    // {first_name} and {company} are filled by buildCampaignMergeValues. A
    // tag outside that set renders as literal braces to a real customer.
    const allowed = new Set(["first_name", "full_name", "email", "company", "unsubscribe_url"]);
    for (const t of CAMPAIGN_TEMPLATES) {
      for (const m of [...t.body.matchAll(/\{([a-z_]+)\}/g)]) {
        expect(allowed.has(m[1]!), `${t.key}: {${m[1]}}`).toBe(true);
      }
    }
  });

  it("looks a template up by key, and refuses an unknown one", () => {
    expect(templateByKey("next_drop")?.name).toBe("Next drop");
    expect(templateByKey("nonsense")).toBeNull();
  });
});
