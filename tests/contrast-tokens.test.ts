import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

/*
  Module scope, not inside one describe.

  Both of these were declared inside the muted-text block, which meant the
  focus-ring checks added later could not see them — and the obvious repair,
  a second copy, is how two definitions of "composite an rgba ground" come to
  disagree. One definition, used by every block below.
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

/*
  ── AAA FOR SECONDARY TEXT, FROM 8 SEP 2026 ──
  1.4.6 asks 7:1 where 1.4.3 asks 4.5:1. The muted tokens were tuned to clear
  it on --surface and --surface-2 in every palette, and on --surface-3 too in
  light, where secondary text sits on the washed grounds most often. The
  shifts were tiny in the dark palettes (#a9a3c1 -> #b1abc6) and visible in
  light (#6d6a7c -> #504e5b), which was the price Jordan chose to pay.

  Asserted separately from the AA block so a future palette that clears AA
  but not AAA fails with the number it actually missed.
*/
/*
  ── WHITE ON THE ACCENT, AT AAA ──
  Every primary button, the active chip and the active tab paint white on
  --accent-grad; a few paint it on flat --accent. At 4.52:1 they were the
  last AAA failure standing on 8 Sep 2026, and the fix was the brand accent
  itself: deepened per palette until white clears 7:1 on every stop. That is
  a visible change to the purple, made on Jordan's instruction that the
  product has to comply with AAA.
*/
describe("white clears AAA (7:1) on the accent", () => {
  const WHITE = { r: 255, g: 255, b: 255 };
  for (const palette of PALETTES) {
    it(`${palette.name} --accent-grad stops`, () => {
      const grad = rawToken(palette.selector, "--accent-grad") ?? rawToken('[data-theme="light"] {', "--accent-grad");
      expect(grad, `${palette.name} has no --accent-grad`).not.toBeNull();
      const stops = (grad!.match(/#[0-9a-fA-F]{6}/g) ?? []).map(parseHex);
      expect(stops.length, "no stops parsed").toBeGreaterThan(0);
      for (const stop of stops) {
        const got = contrastRatio(WHITE, stop!);
        expect(got, `${palette.name} white on ${JSON.stringify(stop)} is ${got.toFixed(2)}:1 — AAA needs 7`).toBeGreaterThanOrEqual(7);
      }
    });
    it(`${palette.name} flat --accent`, () => {
      const raw = rawToken(palette.selector, "--accent") ?? rawToken('[data-theme="light"] {', "--accent");
      const accent = parseHex(raw!);
      expect(accent, `${palette.name} --accent did not parse: ${raw}`).not.toBeNull();
      const got = contrastRatio(WHITE, accent!);
      expect(got, `${palette.name} white on --accent is ${got.toFixed(2)}:1 — AAA needs 7`).toBeGreaterThanOrEqual(7);
    });
  }
});

describe("muted text clears AAA (7:1) on the page grounds", () => {
  for (const palette of PALETTES) {
    for (const name of ["--muted", "--muted-2", "--text-4"]) {
      it(`${palette.name} ${name}`, () => {
        const fg = parseHex(token(palette.selector, name));
        expect(fg, `${palette.name} ${name} did not parse`).not.toBeNull();
        const grounds = palette.name === "light"
          ? ["--surface", "--surface-2", "--surface-3"]
          : ["--surface", "--surface-2"];
        for (const g of grounds) {
          const raw = rawToken(palette.selector, g);
          expect(raw, `${palette.name} has no ${g}`).not.toBeNull();
          const bg = parseHex(raw!);
          expect(bg, `${palette.name} ${g} is not a flat hex: ${raw}`).not.toBeNull();
          const got = contrastRatio(fg!, bg!);
          expect(got, `${palette.name} ${name} on ${g} is ${got.toFixed(2)}:1 — AAA needs 7`).toBeGreaterThanOrEqual(7);
        }
      });
    }
  }
});

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
    /*
     * The warning and danger pairs, added 30 Aug after the UI harness
     * (scripts/ui-harness.mjs) rendered the rotate-key confirmation in all six
     * themes and found the light one failing at 2.68:1 and 2.52:1 — roughly
     * half of AA, on every warning and every destructive confirmation in the
     * product. Five palettes passed, which is exactly why nobody noticed.
     */
    ["--warn-fg", "--warn-bg"],
    ["--pdf-fg", "--pdf-bg"],
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


  /*
    Both muted inks, not just the first.

    --muted was covered here and --muted-2 was not, and --muted-2 is the darker
    of the pair — so the ONE that was checked was the one more likely to pass.
    It cost a real bug: .pba-card-sub carries --muted-2 and measured 4.35:1 on
    the operator console cards, under AA, on the dark theme that console always
    renders in. Found by hand on 31 Aug while measuring something else.
  */
  const MUTED_INKS = ["--muted", "--muted-2"] as const;

  for (const palette of PALETTES) {
    for (const ink of MUTED_INKS) {
    it(`${palette.name} ${ink} on the translucent --surface-3`, () => {
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

      const fg = parseHex(rawToken(palette.selector, ink) ?? "");
      expect(fg, `could not resolve ${ink}`).not.toBeNull();

      const ratio = contrastRatio(fg!, ground!);
      expect(
        ratio,
        `${palette.name} ${ink} measures ${ratio.toFixed(2)}:1 on --surface-3 — AA needs ${MIN_CONTRAST}`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
    }
  }

  /*
    ── ONE WASH IS NOT THE WORST CASE. TWO ARE. ──

    The block above composites --surface-3 over the panel exactly once, which
    is what a chip or an input does. The admin console nests them: a .pba-tile
    inside a .pba-card, each carrying the wash, so the ink sits on a ground
    lifted TWICE toward it. Every extra layer costs contrast.

    That gap was worth about half a point and it was real. On 6 Sep the console
    measured --muted at 3.97:1 and --muted-2 at 3.92:1 on that doubly washed
    ground, while both passed every single-wash assertion above — and it is
    where the console's table column headers and tile labels live, which are
    the labels saying what each number means. Found in a browser, at 375px,
    because nothing here modelled a second layer.

    Two is the depth the product actually paints; this does not try to prove
    anything about three.
  */
  for (const palette of PALETTES) {
    for (const ink of MUTED_INKS) {
      it(`${palette.name} ${ink} on two stacked --surface-3 washes`, () => {
        const raw = rawToken(palette.selector, "--surface-3");
        if (!raw) return; // palette inherits one already checked

        const base =
          parseHex(rawToken(palette.selector, "--panel") ?? "") ??
          parseHex(rawToken(palette.selector, "--surface") ?? "");
        expect(base, "no opaque base to composite over").not.toBeNull();

        // An opaque --surface-3 cannot stack — the second layer hides the
        // first — so one layer is already the worst case and the block above
        // covers it.
        if (raw.startsWith("#")) return;

        const once = composite(raw, base!);
        expect(once, `could not resolve --surface-3 ("${raw}")`).not.toBeNull();
        const twice = composite(raw, once!);
        expect(twice, `could not stack --surface-3 ("${raw}")`).not.toBeNull();

        const fg = parseHex(rawToken(palette.selector, ink) ?? "");
        expect(fg, `could not resolve ${ink}`).not.toBeNull();

        const ratio = contrastRatio(fg!, twice!);
        expect(
          ratio,
          `${palette.name} ${ink} measures ${ratio.toFixed(2)}:1 on two --surface-3 washes — AA needs ${MIN_CONTRAST}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      });
    }
  }

  /*
    The accent chip's ink.

    --accent-text on --accent-chip, which is a translucent purple laid over the
    panel. It carries the order number on every inbox card and the "latest N
    messages" chip on every thread, so it is small text that people actually
    read a number off.

    Light measured 4.38:1 on 6 Sep and the other four palettes were between
    5.77 and 5.13 — the pale ground is the hard one, because the chip lifts it
    toward a mid-tone ink rather than away from it.
  */
  for (const palette of PALETTES) {
    it(`${palette.name} --accent-text on --accent-chip`, () => {
      const rawChip = rawToken(palette.selector, "--accent-chip");
      if (!rawChip) return; // palette inherits one already checked

      const base =
        parseHex(rawToken(palette.selector, "--surface") ?? "") ??
        parseHex(rawToken(palette.selector, "--panel") ?? "");
      expect(base, "no opaque base to composite over").not.toBeNull();

      const ground = rawChip.startsWith("#") ? parseHex(rawChip) : composite(rawChip, base!);
      expect(ground, `could not resolve --accent-chip ("${rawChip}")`).not.toBeNull();

      const fg = parseHex(rawToken(palette.selector, "--accent-text") ?? "");
      expect(fg, "could not resolve --accent-text").not.toBeNull();

      const ratio = contrastRatio(fg!, ground!);
      expect(
        ratio,
        `${palette.name} --accent-text measures ${ratio.toFixed(2)}:1 on --accent-chip — AA needs ${MIN_CONTRAST}`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  }

  /*
    White ink goes on --accent-grad, never on flat --accent.

    Both are "the accent", and that is the trap: --accent is the lighter
    sibling for borders and focus rings, where 1.4.11 asks for 3:1. Painting a
    button with it and putting white on top measured 3.20:1 in forest and
    3.01:1 in slate — which is what .pbo-go, the onboarding checklist's "Do
    it", did until 6 Sep while every other primary button used the gradient.

    The gradient stops are already tuned for this: 4.51 to 4.55 against white
    in all four palettes that define one. That is a deliberate margin and this
    keeps anyone from spending it.
  */
  for (const palette of PALETTES) {
    it(`${palette.name} white ink clears AA on every --accent-grad stop`, () => {
      const grad = rawToken(palette.selector, "--accent-grad");
      if (!grad) return; // palette inherits one already checked

      const stops = [...grad.matchAll(/#[0-9a-f]{6}/gi)].map((m) => parseHex(m[0]));
      // A gradient nobody could read the stops out of is a broken check, not a
      // passing one — the same rule as --surface-3 above.
      expect(stops.length, `no colour stops parsed from --accent-grad ("${grad}")`).toBeGreaterThan(0);
      expect(stops.every(Boolean), "a stop failed to parse").toBe(true);

      for (const stop of stops) {
        const ratio = contrastRatio(WHITE, stop!);
        expect(
          ratio,
          `${palette.name} white measures ${ratio.toFixed(2)}:1 on an --accent-grad stop — AA needs ${MIN_CONTRAST}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    });
  }

  /*
    ── AND NOTHING MAY PAINT WHITE ON FLAT --accent ──
    The block above proves the gradient's stops keep their margin. It does not
    stop the mistake that was actually found, because that mistake was not in
    the tokens: .pbo-go set `background: var(--accent)` with `color: #fff`, and
    every token involved was fine on its own.

    So this reads the stylesheets. --accent is the LIGHT sibling, for borders
    and focus rings where 1.4.11 asks 3:1; it measures 3.20:1 and 3.01:1
    against white in forest and slate. White ink belongs on --accent-grad or
    --accent-strong.
  */
  /*
    Every stylesheet under app/ and components/, FOUND rather than listed.

    The hardcoded list this replaces named nine files. The repo has twenty,
    and the eleven it omitted included pricing.css, contact.css, subscribe.css
    and the admin console's own sheet — every public marketing page, in other
    words. A guard is only as wide as its input, and a list that has to be
    edited by hand when a file is added is a guard that quietly narrows.
  */
  function stylesheets(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith(".css")) found.push(rel);
      }
    };
    walk("app");
    walk("components");
    return found;
  }

  /*
    ── THE NAVIGATION IS DARK IN ALL SIX THEMES, SO ITS INK MUST BE TOO ──

    .pb-sidebar and the mobile top bar are painted with --nav, which is
    near-black indigo in every palette including the light one. They set no
    colour of their own, so they inherited the PAGE ink — --text and --muted-2,
    which do follow the theme.

    In the five dark palettes that read correctly by coincidence. In light it
    was #221b3a on #1c1830: measured 1.05:1 on 7 Sep 2026, on the default
    theme, on the navigation column of every signed-in screen. Twenty-five
    failing elements on one component.

    It lasted because nothing had ever RENDERED MailNav — the five component
    harnesses drop their view into a bare shell with no nav in it, so the most
    universal component in the product was the least looked at.

    --nav-fg and --nav-muted exist for this, and this checks them against the
    ground they are actually painted on rather than against a page surface.
  */
  for (const palette of PALETTES) {
    for (const [name, min] of [
      ["--nav-fg", MIN_CONTRAST],
      // The muted nav ink is used at 11px and up, so it needs the full 4.5:1
      // as well — none of it is large text.
      ["--nav-muted", MIN_CONTRAST],
    ] as const) {
      it(`${palette.name} ${name} clears AA on --nav`, () => {
        /*
          Inherited rather than redeclared is CORRECT for dark and system-dark:
          the base values in the light block are already that palette's own
          text colours. So fall back to the light block rather than demanding
          a copy in every palette, which is how six declarations drift apart.
        */
        const raw = rawToken(palette.selector, name) ?? rawToken('[data-theme="light"] {', name);
        expect(raw, `${palette.name} has no ${name} and no base to inherit`).not.toBeNull();
        const fg = parseHex(raw!);
        const bg = parseHex(token(palette.selector, "--nav"));
        expect(fg, `${name} did not parse: ${raw}`).not.toBeNull();
        expect(bg, `${palette.name} --nav did not parse`).not.toBeNull();
        const got = contrastRatio(fg!, bg!);
        expect(
          got,
          `${palette.name} ${name} measures ${got.toFixed(2)}:1 on --nav — AA needs ${MIN_CONTRAST}`,
        ).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it("no rule puts white ink on a flat --accent background", () => {
    const files = stylesheets();
    // The list used to be typed out and had drifted to under half the sheets.
    expect(files.length, "stylesheet discovery found almost nothing").toBeGreaterThan(15);

    const offenders: string[] = [];
    let blocksScanned = 0;

    for (const file of files) {
      const css = readFileSync(join(process.cwd(), file), "utf8");

      for (const block of css.split("}")) {
        const body = block.slice(block.indexOf("{") + 1);
        if (!body.trim()) continue;
        blocksScanned++;
        // var(--accent) exactly: the ) has to follow, or --accent-grad,
        // --accent-strong, --accent-soft and --accent-chip all match too.
        const flatAccentBg = /background(?:-color)?:\s*var\(--accent\)/.test(body);
        if (!flatAccentBg) continue;
        const whiteInk = /color:\s*(#fff\b|#ffffff\b|white\b|var\(--on-accent\))/i.test(body);
        if (whiteInk) {
          offenders.push(`${file}: ${block.slice(0, 60).replace(/\s+/g, " ").trim()}`);
        }
      }
    }

    // The canary: a scanner that matched nothing anywhere would pass silently.
    expect(blocksScanned, "no CSS blocks were scanned").toBeGreaterThan(200);
    expect(offenders, "white ink on flat --accent — use --accent-grad").toEqual([]);
  });

  /*
    The same rule, for inline styles in components.

    ── WHY THIS EXISTS ──
    The CSS scan above was added on 6 Sep after white-on-flat-accent was found
    in four rules. On 7 Sep a browser sweep found a FIFTH, on /no-access:
    3.20:1 in forest, 3.01:1 in slate. The guard had not failed — it had never
    been able to see the file, because the offending declaration was a React
    style object in a .tsx and the scan reads .css.

    A guard with a known blind spot is how the same bug ships twice.

    Matching is deliberately loose about spacing and quote style, since the
    shape here is `background: "var(--accent)"` rather than a CSS declaration,
    and prettier may or may not put it on one line.
  */
  it("no inline style puts white ink on a flat --accent background", () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith(".tsx")) sources.push(rel);
      }
    };
    walk("app");
    walk("components");
    expect(sources.length, "no components found to scan").toBeGreaterThan(20);

    const offenders: string[] = [];
    let objectsScanned = 0;

    for (const file of sources) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      // Each `style={{ ... }}` object, and each standalone style const.
      for (const block of src.split(/style=\{\{|style:\s*\{/).slice(1)) {
        const obj = block.slice(0, block.indexOf("}"));
        if (!obj.trim()) continue;
        objectsScanned++;
        // The closing paren must follow, or --accent-grad and --accent-soft
        // match too — the same trap the CSS scan documents.
        if (!/background(?:Color)?:\s*["'`]var\(--accent\)["'`]/.test(obj)) continue;
        if (/color:\s*["'`](#fff\b|#ffffff\b|white\b|var\(--on-accent\))["'`]/i.test(obj)) {
          offenders.push(`${file}: ${obj.replace(/\s+/g, " ").trim().slice(0, 70)}`);
        }
      }
    }

    expect(objectsScanned, "no inline style objects were scanned").toBeGreaterThan(20);
    expect(offenders, "white ink on flat --accent in an inline style").toEqual([]);
  });

  it("still measures something rather than passing on an empty set", () => {
    // If token() ever started returning nothing, every assertion above would
    // vacuously pass. This is the canary for that.
    expect(parseHex(token('[data-theme="light"] {', "--muted"))).not.toBeNull();
    expect(PALETTES.length).toBeGreaterThanOrEqual(5);
  });
});

/**
 * The keyboard focus ring, held to a different standard from text.
 *
 * WCAG 1.4.11 asks a non-text indicator to reach 3:1 against ADJACENT colours,
 * not the 4.5:1 the rest of this file checks. Painted with --accent directly it
 * measured 2.64:1 (dark) and 2.68:1 (ocean) against --surface-3 — the ground
 * inputs, chips and cards sit on, so exactly the surface a keyboard user tabs
 * across. Light, forest and slate passed, which is why it read as fine.
 *
 * --surface-3 is included deliberately: it is the least forgiving ground and
 * the one the earlier version of this file had to composite by hand, so it is
 * the ground most likely to be left out of a check written quickly.
 */
describe("the focus ring clears 3:1 on the grounds it is drawn over", () => {
  const MIN_NON_TEXT = 3;
  const RING_GROUNDS = ["--surface", "--surface-3", "--nav"];

  for (const palette of PALETTES) {
    for (const ground of RING_GROUNDS) {
      it(`${palette.name} focus ring on ${ground}`, () => {
        /*
          --focus-ring where a palette declares one, --accent otherwise. That
          fallback is the same one the CSS uses, so this measures what is
          actually painted rather than what a palette happens to name.
        */
        let ringRaw: string;
        try {
          ringRaw = rawToken(palette.selector, "--focus-ring") ?? "";
        } catch {
          ringRaw = "";
        }
        if (!ringRaw) {
          ringRaw =
            rawToken(palette.selector, "--accent") ??
            rawToken(":root,", "--accent") ??
            "";
        }
        const ring = parseHex(ringRaw);
        expect(ring, `could not resolve a focus ring for ${palette.name}`).not.toBeNull();

        const base =
          parseHex(rawToken(palette.selector, "--panel") ?? "") ??
          parseHex(rawToken(palette.selector, "--surface") ?? "");
        const raw = rawToken(palette.selector, ground);
        if (!raw) return; // not declared in this palette; it inherits one checked already

        // Throws rather than skipping: a ground that cannot be read is a broken
        // test, not an absent problem. Same rule as the --surface-3 block above.
        const bg = raw.startsWith("#") ? parseHex(raw) : composite(raw, base!);
        expect(bg, `could not resolve ${ground} ("${raw}")`).not.toBeNull();

        const ratio = contrastRatio(ring!, bg!);
        expect(
          ratio,
          `${palette.name} focus ring measures ${ratio.toFixed(2)}:1 on ${ground} — WCAG 1.4.11 needs ${MIN_NON_TEXT}`,
        ).toBeGreaterThanOrEqual(MIN_NON_TEXT);
      });
    }
  }
});
