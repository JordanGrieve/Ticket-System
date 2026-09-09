import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

/**
 * Every stylesheet parses.
 *
 * ── WHY THIS EXISTS ──
 * On 9 Sep 2026 a line-range deletion in app/settings.css left a stray `}`
 * behind. `npm run typecheck` passed, `npm run lint` passed, all 1347 tests
 * passed, and the push was made on the strength of that — then the
 * production build failed in CI on `CssSyntaxError: Unexpected }`, and the
 * fix that was supposed to ship sat undeployed while the live site kept
 * serving the old one. Nothing in the pre-push checks reads a stylesheet as
 * CSS; the type guards read them as TEXT (regex over tokens), so a file that
 * does not parse can still satisfy every one of them.
 *
 * PostCSS is what Next runs the files through, so its verdict is the
 * build's. Discovered, not listed: a hardcoded list is how the same guard
 * missed the marketing pages once before.
 */

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) return [];
      return walk(join(dir, e.name));
    }
    return e.name.endsWith(".css") ? [join(dir, e.name)] : [];
  });
}

describe("every stylesheet parses as CSS", () => {
  const files = [...walk("app"), ...walk("components")];

  it("found the stylesheets", () => {
    // A guard as wide as its input: if discovery broke, this fails rather
    // than the parse loop passing over nothing.
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files).toContain(join("app", "settings.css"));
    expect(files).toContain(join("app", "mail.css"));
    expect(files).toContain(join("app", "globals.css"));
  });

  for (const file of files) {
    it(file, () => {
      // Throws with line:column on a syntax error — the message the build
      // would have shown, an hour earlier.
      expect(() => postcss.parse(readFileSync(file, "utf8"))).not.toThrow();
    });
  }
});
