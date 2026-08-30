import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHex, contrastRatio, MIN_CONTRAST } from "../lib/email-colour";

/**
 * Muted text is readable in every theme.
 *
 * ── WHAT THIS CAUGHT ──
 * The light theme shipped `--muted: #a49fba`, which measures 2.55:1 on white
 * and 2.21:1 on the bento panel. AA for body text is 4.5:1. That is not a
 * near miss — it is the marketing page's preview text, timestamps and metadata
 * rendered at roughly half the required contrast, on the page the product is
 * sold from. The dark theme was marginal at 4.43:1.
 *
 * It went unnoticed because muted text is SUPPOSED to look faint, so nothing
 * about it reads as broken to somebody with good eyesight on a good screen.
 * That is exactly the class of defect a number catches and an eye does not.
 *
 * ── WHY THE PALEST GROUND AND NOT THE COMMONEST ──
 * These tokens are painted on several surfaces. Checking only white would have
 * passed a value that still failed on the pale panel, which is how the first
 * attempt at this fix went: #787488 cleared white at 4.51:1 and left the bento
 * ground at 3.92:1. The floor has to be the worst pairing that actually
 * occurs, so that is what is asserted.
 *
 * Reuses lib/email-colour.ts for the arithmetic. Same WCAG formula, one
 * implementation — a second copy would be a second thing to get wrong, and
 * this file exists precisely because contrast maths done twice tends to
 * disagree.
 */

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/**
 * Read a custom property out of the block that follows `selector`.
 *
 * Deliberately naive — first match after the selector — because globals.css
 * declares each palette once, in order. The guard is that a missing or moved
 * token throws rather than silently returning the previous theme's value.
 */
function token(selector: string, name: string): string {
  const at = CSS.indexOf(selector);
  if (at === -1) throw new Error(`No such selector in globals.css: ${selector}`);
  const block = CSS.slice(at, CSS.indexOf("\n}", at));
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block);
  if (!m) throw new Error(`${selector} does not declare ${name}`);
  return m[1]!;
}

/**
 * The grounds muted text is painted on, per palette, palest (worst) first.
 * Taken from the same blocks rather than hard-coded guesses.
 */
const PALETTES: { name: string; selector: string; grounds: string[] }[] = [
  { name: "light", selector: '[data-theme="light"] {', grounds: ["--surface", "--surface-2", "--panel"] },
  { name: "dark", selector: '[data-theme="dark"] {', grounds: ["--surface", "--surface-2", "--panel"] },
  { name: "forest", selector: '[data-theme="forest"] {', grounds: ["--surface", "--surface-2", "--panel"] },
  { name: "slate", selector: '[data-theme="slate"] {', grounds: ["--surface", "--surface-2", "--panel"] },
  { name: "ocean", selector: '[data-theme="ocean"] {', grounds: ["--surface", "--surface-2", "--panel"] },
];

describe("muted text clears AA in every theme", () => {
  for (const palette of PALETTES) {
    for (const name of ["--muted", "--muted-2"]) {
      it(`${palette.name} ${name}`, () => {
        const fg = parseHex(token(palette.selector, name));
        expect(fg, `${name} is not a hex colour`).not.toBeNull();

        // Only hex grounds can be measured; a token declared as rgba() with
        // transparency has no fixed ground and is skipped rather than guessed.
        const grounds = palette.grounds
          .map((g) => {
            try {
              return parseHex(token(palette.selector, g));
            } catch {
              return null;
            }
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);

        expect(grounds.length, "no measurable ground for this palette").toBeGreaterThan(0);

        for (const bg of grounds) {
          const ratio = contrastRatio(fg!, bg);
          expect(
            ratio,
            `${palette.name} ${name} measures ${ratio.toFixed(2)}:1 — AA needs ${MIN_CONTRAST}`,
          ).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      });
    }
  }

  it("still measures something rather than passing on an empty set", () => {
    // If token() ever started returning nothing, every assertion above would
    // vacuously pass. This is the canary for that.
    expect(parseHex(token('[data-theme="light"] {', "--muted"))).not.toBeNull();
    expect(PALETTES.length).toBeGreaterThanOrEqual(5);
  });
});
