import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 2.3.3 Animation from Interactions (AAA): a reader who has asked the
 * operating system for reduced motion gets none.
 *
 * Two stylesheets animated things with no prefers-reduced-motion block at all
 * on 8 Sep 2026, so the guarantee moved to one blanket rule in globals.css
 * (WAI technique C39) rather than a promise that every file remembers. This
 * pins that rule: that it exists, that it is the universal selector, and that
 * it covers both animation and transition — a version that silenced only one
 * of the two would pass a looser check and leave the other running.
 */
describe("reduced motion is honoured everywhere", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("globals.css carries the blanket C39 rule", () => {
    const at = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(at, "no reduced-motion block in globals.css").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}", css.indexOf("{", at) + 1));
    expect(block, "the blanket rule must select every element").toMatch(/^\s*\*,\s*\n\s*\*::before,\s*\n\s*\*::after\s*\{/m);
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("is the last thing in the file, so nothing can come after and re-enable motion", () => {
    const at = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    const rest = css.slice(css.indexOf("\n}", at) + 2).trim();
    expect(rest, `rules after the blanket block: ${rest.slice(0, 60)}`).toBe("");
  });
});
