import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The AI prompt a client hands to whatever built their website.
 *
 * ── WHY THIS IS NOW THE LOAD-BEARING FILE ──
 *
 * Until 14 Sep 2026 the contact form had three install modes, and the default
 * was a pasteable JavaScript snippet. It opened with
 * `document.querySelector("#contact-form")` and `if (!form) return;`, so on any
 * site whose form is called something else it did precisely nothing — no error,
 * no console warning, no clue. Shopify's is `contact_form`, with an underscore,
 * which is most of a whole platform failing in total silence.
 *
 * No hardcoded selector can be right for every site, so the snippet is gone
 * rather than improved, and this prompt is the primary path: the thing doing
 * the wiring can SEE the page, which is the only way to find a form reliably.
 * Jordan's call — "we should never do our own styling".
 *
 * That makes these assertions more valuable than they were, and more dangerous
 * to get wrong. This text is EXECUTED — by a language model, on a real
 * business's live website, unsupervised, by an owner who cannot read the code
 * that comes out. A missing sentence here is a missing behaviour on their
 * contact page and nobody in the chain is positioned to notice.
 *
 * Static assertions over the source, the same instrument as
 * tests/install-newsletter-prompt.test.ts and for the same reason: this lives
 * in a client component and rendering it needs React, Clerk and a workspace.
 */

const SRC = readFileSync(
  join(process.cwd(), "components/InstallView.tsx"),
  "utf8",
);

/** Just the contact prompt, so assertions cannot match elsewhere in the file. */
function promptSource(): string {
  const start = SRC.indexOf("const snippetAI = `");
  expect(start, "the contact AI prompt is gone or renamed").toBeGreaterThan(-1);
  const end = SRC.indexOf("`;", start);
  expect(end).toBeGreaterThan(start);
  const text = SRC.slice(start, end);
  // Guard the extraction: an empty slice would leave every `toContain` below
  // failing loudly, but a slice of the WHOLE file would let them all pass.
  expect(text).toContain("## Your task");
  expect(text.length).toBeLessThan(SRC.length / 2);
  return text;
}

/**
 * The prompt as one line.
 *
 * The prompt is hard-wrapped in the source, so a sentence that reads as one
 * phrase to a model is "failed\nintegration" to a matcher. Asserting against
 * the raw text made two true assertions fail, which is the kind of friction
 * that gets a test weakened rather than a bug fixed. Prose assertions run
 * against this; structural ones (ordering, exact field spellings) run against
 * the raw text, where the line breaks are not in the way.
 */
function prose(): string {
  return promptSource().replace(/\s+/g, " ");
}

describe("the prompt refuses to let an assistant restyle the site", () => {
  const prompt = promptSource();

  it("says so before it says anything else about the work", () => {
    // Position matters in a prompt. The rule that is easiest to break by
    // accident has to arrive before the instructions that invite breaking it.
    const ruleAt = prompt.indexOf("DO NOT CHANGE HOW THE SITE LOOKS");
    const taskAt = prompt.indexOf("## Your task");
    expect(ruleAt, "the styling rule is missing").toBeGreaterThan(-1);
    expect(ruleAt).toBeLessThan(taskAt);
  });

  it("names every kind of change it means", () => {
    // "Don't change the styling" is read as "don't add a stylesheet" by
    // something that then rewrites the markup. Each one is spelled out.
    for (const thing of ["markup", "classes", "CSS", "layout"]) {
      expect(prompt, `the rule does not mention ${thing}`).toContain(thing);
    }
  });

  it("forbids adding a stylesheet or a class of its own", () => {
    expect(prompt).toMatch(/[Aa]dd no stylesheet/);
  });

  it("says what a failed integration looks like, not just what to avoid", () => {
    expect(prose()).toMatch(/visibly different form.*failed integration/);
  });
});

describe("the prompt makes it find the form rather than guess", () => {
  const prompt = promptSource();

  it("tells it not to assume an id", () => {
    expect(prompt).toMatch(/do not assume an id/i);
  });

  it("names the real shapes on the platforms clients are actually on", () => {
    // The exact thing the deleted snippet got wrong. Underscore, not hyphen.
    expect(prompt).toContain("contact_form");
    expect(prompt).toContain("wpcf7-form");
  });

  it("warns that a selector matching nothing fails SILENTLY", () => {
    // The property that made the old snippet so expensive to debug.
    expect(prompt).toMatch(/fails silently/i);
    expect(prompt).toMatch(/verify it matches/i);
  });
});

describe("the prompt maps fields the way the server actually reads them", () => {
  const prompt = promptSource();

  it("names the real field spellings, not invented ones", () => {
    for (const field of ["contact[name]", "contact[body]", "your-name", "form_fields[name]"]) {
      expect(prompt, `the prompt never mentions ${field}`).toContain(field);
    }
  });

  it("offers the option that cannot be got wrong", () => {
    // The server normalises (lib/submission-fields.ts), so forwarding
    // everything is strictly more robust than any mapping the model invents.
    expect(prompt).toMatch(/forward every field/i);
  });
});

describe("the prompt asks for the failure path, not just the happy one", () => {
  const prompt = promptSource();

  it("disables the button while sending", () => {
    expect(prompt).toMatch(/disable the submit button/i);
  });

  it("keeps what the visitor typed when it fails", () => {
    // The most expensive thing an integration can do, and the easiest to omit.
    expect(prose()).toMatch(/DO NOT clear what the visitor typed/i);
  });

  it("handles a rate limit as a wait rather than a retry", () => {
    expect(prompt).toContain("429");
    expect(prompt).toMatch(/try again in a minute/i);
  });

  it("shows the reply without leaving the page", () => {
    expect(prompt).toMatch(/inline success message/i);
    expect(prompt).toMatch(/without leaving the page/i);
  });
});

describe("the prompt tells the truth about the no-JavaScript fallback", () => {
  const prompt = promptSource();

  it("says the visitor leaves the site, and not quietly", () => {
    // The mode's one real cost. An assistant that picks it without saying so
    // changes the visitor's journey and the owner finds out from a customer.
    expect(prompt).toMatch(/hosted\s+confirmation page/);
    expect(prompt).toMatch(/does leave the site/i);
    expect(prompt).toMatch(/rather than choosing it silently/i);
  });

  it("asks for a real test submission at the end", () => {
    expect(prompt).toContain("Integration test");
    expect(prompt).toContain("201");
    // And what to do when it is not 201 — otherwise the check is decorative.
    expect(prompt).toContain("400");
  });
});

describe("the install view no longer ships a pasteable script", () => {
  it("has no snippetB", () => {
    // The whole point of the change. If it comes back, so does a hardcoded
    // selector that silently matches nothing on most of the web.
    expect(SRC).not.toContain("snippetB");
  });

  it("offers exactly two contact modes", () => {
    expect(SRC).toContain('useState<"a" | "ai">("ai")');
  });

  it("does not describe a JavaScript paste mode any more", () => {
    expect(SRC).not.toContain("JavaScript (recommended)");
  });
});
