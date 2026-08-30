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

  /*
   * The accent gradient carries WHITE text — primary buttons, the send
   * control, the nav's active row. Both stops have to clear AA, not the
   * average of them: a gradient that passes on average still has an end where
   * the label is unreadable, and on a 145deg fill that end is the top-left
   * corner where the eye lands first.
   *
   * All four palettes failed before this: 2.10:1 (forest) to 3.72:1 (purple)
   * on the light stop, with forest and slate failing at the dark end as well.
   * Jordan chose to deepen the stops rather than accept it.
   */
  const WHITE = parseHex("#ffffff")!;

  for (const palette of PALETTES) {
    it(`${palette.name} accent gradient carries white text`, () => {
      const at = CSS.indexOf(palette.selector);
      const block = CSS.slice(at, CSS.indexOf("\n}", at));
      const decl = /--accent-grad:[^;]*;/.exec(block);

      // Light and dark share the purple declared on the light palette; a theme
      // that does not restate it inherits one already asserted here.
      if (!decl) return;

      const stops = [...decl[0].matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
      expect(stops.length, "no colour stops found in --accent-grad").toBeGreaterThan(0);

      for (const stop of stops) {
        const ratio = contrastRatio(WHITE, parseHex(stop)!);
        expect(
          ratio,
          `${palette.name} --accent-grad stop ${stop} measures ${ratio.toFixed(2)}:1 against white — AA needs ${MIN_CONTRAST}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    });
  }

  /*
   * Inks that are painted on a KNOWN tinted ground rather than on the page.
   *
   * --accent-text sits on --accent-soft (chips, tags, the marketing pill) and
   * measured 4.29:1 there while looking perfectly safe on white — which is
   * where anyone would have checked it. --ok-fg carries "Delivered" and
   * "Saved" on the plain surface and measured 3.38:1.
   *
   * Only palettes that declare both as hex can be checked here; dark, forest,
   * slate and ocean use rgba() overlays whose real ground depends on what is
   * behind them, and those were verified by rendering instead. A palette that
   * cannot be measured is skipped rather than assumed to pass.
   */
  const ON_TINT: [string, string][] = [
    ["--accent-text", "--accent-soft"],
    ["--ok-fg", "--surface"],
  ];

  for (const palette of PALETTES) {
    for (const [ink, ground] of ON_TINT) {
      it(`${palette.name} ${ink} on ${ground}`, () => {
        let fg, bg;
        try {
          fg = parseHex(token(palette.selector, ink));
          bg = parseHex(token(palette.selector, ground));
        } catch {
          return; // not declared in this palette; it inherits one already checked
        }
        if (!fg || !bg) return; // rgba() overlay — checked by rendering

        const ratio = contrastRatio(fg, bg);
        expect(
          ratio,
          `${palette.name} ${ink} measures ${ratio.toFixed(2)}:1 on ${ground} — AA needs ${MIN_CONTRAST}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      });
    }
  }

  /*
   * --surface-3 is a TRANSLUCENT overlay in four of the five palettes, e.g.
   * rgba(255, 255, 255, 0.05). parseHex cannot read it, so the assertions
   * above skipped it — and it is the ground with the least contrast, because
   * a white wash over a dark panel lifts the background toward the text.
   *
   * That gap was real: --muted measured 3.93:1 (dark), 3.99:1 (ocean) and
   * 4.01:1 (slate) on chips and inputs, while passing every opaque surface.
   * Skipping a ground because it is awkward to parse is how a test reports
   * green on the exact pairing that fails, so it is composited here instead.
   */
  function composite(overlay: string, base: NonNullable<ReturnType<typeof parseHex>>) {
    const m =
      /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/.exec(
        overlay,
      );
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    const mix = (c: number, b: number) => c * a + b * (1 - a);
    return {
      r: mix(Number(m[1]), base.r),
      g: mix(Number(m[2]), base.g),
      b: mix(Number(m[3]), base.b),
    };
  }

  /** Raw declaration text, so an rgba() value survives to be composited. */
  function rawToken(selector: string, name: string): string | null {
    const at = CSS.indexOf(selector);
    if (at === -1) return null;
    const block = CSS.slice(at, CSS.indexOf("\n}", at));
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
    return m ? m[1]!.trim() : null;
  }

  for (const palette of PALETTES) {
    it(`${palette.name} --muted on the translucent --surface-3`, () => {
      const raw = rawToken(palette.selector, "--surface-3");
      if (!raw) return; // palette inherits one already checked

      // The panel the overlay is painted over.
      const base =
        parseHex(rawToken(palette.selector, "--panel") ?? "") ??
        parseHex(rawToken(palette.selector, "--surface") ?? "");
      expect(base, "no opaque base to composite over").not.toBeNull();

      /*
       * Throws rather than returning. The first version of this file used
       * `if (!ground) return`, and a mangled regex made composite() return
       * null for every palette — so the whole check passed green while
       * measuring nothing at all. A ground that cannot be read is a broken
       * test, not an absent problem, and it has to say so.
       */
      const ground = raw.startsWith("#") ? parseHex(raw) : composite(raw, base!);
      expect(ground, `could not resolve --surface-3 ("${raw}")`).not.toBeNull();

      const fg = parseHex(rawToken(palette.selector, "--muted") ?? "");
      expect(fg, "could not resolve --muted").not.toBeNull();

      const ratio = contrastRatio(fg!, ground!);
      expect(
        ratio,
        `${palette.name} --muted measures ${ratio.toFixed(2)}:1 on --surface-3 — AA needs ${MIN_CONTRAST}`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  }

  it("still measures something rather than passing on an empty set", () => {
    // If token() ever started returning nothing, every assertion above would
    // vacuously pass. This is the canary for that.
    expect(parseHex(token('[data-theme="light"] {', "--muted"))).not.toBeNull();
    expect(PALETTES.length).toBeGreaterThanOrEqual(5);
  });
});
