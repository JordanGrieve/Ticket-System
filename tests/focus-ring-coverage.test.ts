import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The focus ring reaches every kind of thing that can take focus.
 *
 * ── THIS LIST HAS FALLEN BEHIND TWICE, NOW THREE TIMES ──
 * app/globals.css replaces the browser's default focus ring with one held to
 * WCAG 1.4.11 (3:1 against the grounds this product paints). That is only true
 * for the selectors actually in the list. <select> and [tabindex] were missing
 * once and were added with a note explaining why; on 6 Sep 2026 <summary> was
 * missing too — four ship, and the pricing FAQ is on a page any stranger can
 * reach.
 *
 * Nothing catches this by looking. A missing selector does not break: the
 * element still gets A ring, just the browser's, which is visible enough to
 * pass a glance and was never measured against --surface-3.
 *
 * So the rule is checked against the elements the product actually renders,
 * rather than against a list somebody remembers to update.
 *
 * ── WHY NOT MEASURE IT IN A BROWSER ──
 * :focus-visible only matches while the DOCUMENT has focus, and a browser pane
 * driven by tooling does not. The probe that tried reported fourteen failures
 * on a page whose focus styles were fine. Reading the stylesheet is the honest
 * instrument here; the ring's CONTRAST is measured separately in
 * tests/contrast-tokens.test.ts.
 */

const FOCUSABLE_TAGS = ["a", "button", "select", "input", "textarea", "summary"];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("the focus ring covers everything focusable", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  // The block that replaces the browser ring. Found by its outline, not by a
  // line number, so it survives the file moving around.
  const ruleStart = css.indexOf(":focus-visible");
  const braceAt = css.indexOf("{", ruleStart);
  const selectors = css.slice(css.lastIndexOf("}", ruleStart) + 1, braceAt);
  const body = css.slice(braceAt, css.indexOf("}", braceAt));

  it("found the rule at all", () => {
    // The canary: a rename would otherwise make every assertion below vacuous.
    expect(ruleStart, "no :focus-visible rule in app/globals.css").toBeGreaterThan(0);
    expect(body, "the focus rule no longer sets an outline").toContain("outline:");
    expect(body).toContain("--focus-ring");
  });

  const files = [...tsxFiles("app"), ...tsxFiles("components")];

  it("scanned the source", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const tag of FOCUSABLE_TAGS) {
    it(`<${tag}> is covered wherever the product renders one`, () => {
      const rendered = files.some((f) => {
        const src = readFileSync(f, "utf8");
        // Opening tag in JSX. Template strings hold the snippet we hand
        // clients for their own site, which our stylesheet never reaches, so
        // a match inside backticks does not count.
        // No `s` flag: the negated class already matches newlines, and dotAll
        // needs an es2018 target this tsconfig does not set. Typecheck caught
        // that; the test suite did not, because vitest transpiles with esbuild
        // and never consults the target.
        const withoutTemplates = src.replace(/`(?:[^`\\]|\\.)*`/g, "``");
        return new RegExp("<" + tag + "[\\s/>]").test(withoutTemplates);
      });
      if (!rendered) return; // nothing to cover

      expect(
        selectors,
        `<${tag}> is rendered somewhere but is not in the :focus-visible list, so it keeps the browser's default ring`,
      ).toContain(tag + ":focus-visible");
    });
  }
});
