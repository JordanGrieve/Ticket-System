import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHex, contrastRatio } from "../lib/email-colour";

/**
 * Every syntax colour clears AAA on the ground it is painted on.
 *
 * ── WHY THIS FILE EXISTS ──
 * Syntax highlighting is where an accessibility bar goes quietly missing. A
 * shipped editor theme is tuned for people who stare at it all day on a good
 * monitor, not to 1.4.6: VS Code's Dark+ comment green is about 4.2:1 on its
 * own background, GitHub Light's is about 4.6:1. Both are fine by their own
 * lights and neither would pass here, so the palette in globals.css was chosen
 * by measurement and has to stay that way — "make it look like VS Code" is an
 * instruction about hues, and the first commit that answers it with an editor's
 * actual hex values is the one this test is waiting for.
 *
 * It is also the only check that can see a MISSING value. A token declared in
 * light and forgotten in dark does not fail to compile, does not fail to
 * parse, and renders as whatever the ink inherits — which on a near-black code
 * block is how #3f2b93 once ended up on #1c1830. Both palettes are read, and a
 * token absent from either throws.
 *
 * The arithmetic is lib/email-colour.ts, the same implementation
 * tests/contrast-tokens.test.ts uses. Contrast maths written twice disagrees.
 */

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** Every ink painted on --code-bg, by token name. */
const INKS = [
  "--code-fg",
  "--code-head",
  "--code-comment",
  "--code-str",
  "--code-num",
  "--code-url",
  "--code-key",
  "--code-tag",
  "--code-attr",
  "--code-punct",
] as const;

const PALETTES = [
  { name: "light", selector: ":root,\n[data-theme=\"light\"] {" },
  { name: "dark", selector: '[data-theme="dark"] {' },
  { name: "system dark", selector: "@media (prefers-color-scheme: dark) {" },
] as const;

/**
 * The text of the block `selector` opens, brace-matched.
 *
 * Bounded on purpose. Reading from the selector to the end of the FILE passes
 * this whole suite today — the media block is last, so there is nothing after
 * it to find — and would start lying the day a palette is appended below it: a
 * token missing from one block would be answered by another block's value and
 * report as present and passing. Counting braces also handles the media query,
 * whose palette is a nested `:root` and so has no "\n}" of its own to stop at.
 */
function block(selector: string): string {
  const at = CSS.indexOf(selector);
  if (at === -1) throw new Error(`No such selector in globals.css: ${selector}`);

  const open = CSS.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(open, i);
  }
  throw new Error(`Unclosed block in globals.css at ${selector}`);
}

function token(selector: string, name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block(selector));
  if (!m) throw new Error(`${selector} does not declare ${name}`);
  return m[1]!;
}

/**
 * parseHex returns null for anything it cannot read, and a null that silently
 * skips a measurement is the failure mode AGENTS.md names: a check that cannot
 * see its input reports the same as a check that found nothing wrong. This
 * throws with the value instead.
 */
function rgb(hex: string) {
  const parsed = parseHex(hex);
  if (!parsed) throw new Error(`Not a colour globals.css can mean: ${hex}`);
  return parsed;
}

/**
 * AAA for body text. The code block is 0.78125rem — 12.5px — so it is small
 * text by 1.4.6 and gets the full bar, not the 4.5:1 large-text concession.
 */
const AAA = 7;

describe("the code block's syntax colours", () => {
  for (const palette of PALETTES) {
    describe(palette.name, () => {
      const ground = token(palette.selector, "--code-bg");

      for (const ink of INKS) {
        it(`${ink} clears ${AAA}:1 on --code-bg`, () => {
          const value = token(palette.selector, ink);
          const ratio = contrastRatio(rgb(value), rgb(ground));
          expect(
            Number(ratio.toFixed(2)),
            `${ink} is ${value} on ${ground} — ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AAA);
        });
      }

      it("gives each kind a colour of its own", () => {
        /*
         * Two kinds sharing a hex is not a contrast failure and is still a bug:
         * the whole point of colouring a string differently from a number is
         * that they look different. It is the shape a palette drifts into when
         * a value gets tuned for contrast by copying its neighbour.
         *
         * --code-fg is excluded: plain body text sharing an ink with a token
         * kind is a deliberate option, not a mistake.
         */
        const inks = INKS.filter((i) => i !== "--code-fg").map((i) => [
          i,
          token(palette.selector, i).toLowerCase(),
        ]);
        const seen = new Map<string, string[]>();
        for (const [name, value] of inks) {
          seen.set(value!, [...(seen.get(value!) ?? []), name!]);
        }
        const shared = [...seen].filter(([, names]) => names.length > 1);
        expect(
          shared.map(([value, names]) => `${value}: ${names.join(" and ")}`),
          "two token kinds are painted the same colour",
        ).toEqual([]);
      });
    });
  }

  it("the light and dark grounds are actually different", () => {
    /*
     * The literal request. The block was --brand-panel in both themes, so a
     * client in light mode got a near-black slab in the middle of a white page
     * — "the code does not have a light theme" (Jordan, 14 Sep 2026). If these
     * two ever converge again, that is the regression, and it would otherwise
     * only be visible to somebody who switched themes and looked.
     */
    const light = token(PALETTES[0].selector, "--code-bg");
    const dark = token(PALETTES[1].selector, "--code-bg");
    expect(light.toLowerCase()).not.toBe(dark.toLowerCase());

    // And light really is the light one, rather than the two having swapped.
    const white = rgb("#ffffff");
    expect(contrastRatio(rgb(light), white)).toBeLessThan(
      contrastRatio(rgb(dark), white),
    );
  });
});
