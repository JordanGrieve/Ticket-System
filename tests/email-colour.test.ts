import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  parseHex,
  toHex,
  contrastRatio,
  darkenToContrast,
  MIN_CONTRAST,
} from "../lib/email-colour";
import { PALETTES, emailAccent } from "../lib/newsletter";

/**
 * The brand accent, made readable.
 *
 * Everything here exists because an email cannot be corrected after it is
 * sent. In the app, a colour that turns out to be unreadable is a bug somebody
 * fixes on Tuesday; in a newsletter it is forty thousand people who received a
 * message with an invisible link.
 */

const WHITE = parseHex("#ffffff")!;
const CARD = parseHex("#faf8f4")!; // the branded shell's ground

describe("reading a hex", () => {
  it("takes both lengths and is case-insensitive", () => {
    expect(parseHex("#AABBCC")).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHex("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex("  #6d4aff ")).toEqual({ r: 109, g: 74, b: 255 });
  });

  it("refuses everything that is not one", () => {
    for (const bad of [
      "red",
      "rgb(255,0,0)",
      "#ff00",
      "#ff000000",
      "ff0000",
      "#gggggg",
      null,
      undefined,
      42,
      {},
      [],
    ]) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it("round-trips", () => {
    expect(toHex(parseHex("#6d4aff")!)).toBe("#6d4aff");
  });
});

describe("contrast, against the WCAG reference values", () => {
  it("black on white is 21:1 and a colour on itself is 1:1", () => {
    expect(contrastRatio(parseHex("#000")!, WHITE)).toBeCloseTo(21, 4);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 6);
  });

  it("does not care which way round the arguments go", () => {
    const a = parseHex("#2fa36b")!;
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
  });
});

describe("a brand colour never decides its own legibility", () => {
  it("leaves an already-readable colour exactly as authored", () => {
    // Byte for byte: somebody who picked a good colour must get their colour.
    const good = parseHex("#8a3a12")!;
    expect(contrastRatio(good, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(darkenToContrast(good, WHITE)).toEqual(good);
  });

  it("rescues the colours that are actually unreadable", () => {
    /*
     * Each of these is a plausible brand colour and each fails badly on white.
     * The pale yellow is the case that motivated the whole file: a bakery
     * picks it, the composer shows it, and the customer sees a blank line
     * where the link was.
     */
    for (const hex of ["#ffe94a", "#ffffff", "#f5f5f5", "#7fffd4", "#ffc0cb"]) {
      const before = contrastRatio(parseHex(hex)!, WHITE);
      expect(before).toBeLessThan(MIN_CONTRAST);
      const after = darkenToContrast(parseHex(hex)!, WHITE);
      expect(contrastRatio(after, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("holds for every colour in a wide sweep, on both grounds", () => {
    /*
     * The postcondition is the whole point, so it is asserted exhaustively
     * rather than on a handful of picks. Rounding to whole bytes at the end is
     * what makes this non-obvious: the unrounded answer can sit exactly on the
     * threshold and round down through it.
     */
    let checked = 0;
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          for (const ground of [WHITE, CARD]) {
            const out = darkenToContrast({ r, g, b }, ground);
            expect(contrastRatio(out, ground)).toBeGreaterThanOrEqual(
              MIN_CONTRAST,
            );
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(9000);
  });

  it("changes the colour as little as it can get away with", () => {
    /*
     * A rescue that always returned black would satisfy the contrast test and
     * defeat the feature — the point is that the colour stays recognisably
     * the client's. Nudging the result back toward the original must break it.
     */
    const accent = parseHex("#ffd400")!;
    const fixed = darkenToContrast(accent, WHITE);
    const nudged = {
      r: Math.min(255, fixed.r + 12),
      g: Math.min(255, fixed.g + 12),
      b: Math.min(255, fixed.b + 12),
    };
    expect(contrastRatio(nudged, WHITE)).toBeLessThan(MIN_CONTRAST);
  });

  it("keeps the hue recognisable rather than washing it to grey", () => {
    // Scaling preserves channel ratios, so a yellow stays a yellow.
    const fixed = darkenToContrast(parseHex("#ffd400")!, WHITE);
    expect(fixed.r).toBeGreaterThan(fixed.b);
    expect(fixed.g).toBeGreaterThan(fixed.b);
  });

  it("goes lighter instead when the ground is dark", () => {
    /*
     * No template renders on black today. This is guarded because a
     * darkening-only version would return black-on-black for whoever adds one,
     * and would do it silently.
     */
    const dark = parseHex("#111111")!;
    const out = darkenToContrast(parseHex("#1a1a2e")!, dark);
    expect(contrastRatio(out, dark)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(out.r).toBeGreaterThan(0x1a);
  });
});

/**
 * Every colour literal written into the email, measured against the two
 * grounds the email actually has.
 *
 * ── THE ACCENT WAS GUARDED AND THE REST WERE NOT ──
 * darkenToContrast exists because the brand accent is chosen by a client and
 * could be anything. That left the impression this file was handled. It was
 * not: the fixed greys around it had never been measured, and #a49a89 — the
 * unsubscribe prompt and the postal identification, both 12px — sat at 2.78:1
 * on the white card and 2.62:1 on the page behind it.
 *
 * Those two lines are the least optional text in a commercial email. CAN-SPAM
 * and PECR both ask for identification that is "clear and conspicuous", and a
 * grey a third of the way to its background is a thin answer to that before
 * anyone even reaches the accessibility of it.
 *
 * This reads the renderer rather than a list kept by hand, so a literal added
 * later is measured whether or not anybody remembers this test exists.
 */
describe("the fixed colours in the email clear AA on the grounds they sit on", () => {
  const source = readFileSync(join(process.cwd(), "lib/newsletter.ts"), "utf8");

  // The email has exactly two backgrounds: the white card, and the page behind
  // it. Both are literals in the same file, so a change to either shows up
  // here as a failure rather than as a stale assumption.
  const GROUNDS = ["#ffffff", "#faf8f4"];

  it("the grounds are still the ones this test assumes", () => {
    for (const ground of GROUNDS) {
      expect(source, `${ground} is no longer a background in the renderer`).toContain(
        `background:${ground}`,
      );
    }
  });

  const literals = [...new Set([...source.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];

  it("found the literals at all", () => {
    /*
      The canary: a regex that matched nothing would make the loop below pass
      by iterating over an empty list. This repo has been bitten by exactly
      that — a mangled regex inside a check that reported green.

      It very nearly happened again on 27 Sep 2026, and the canary is the
      reason it did not. The editorial layout moved almost every one of these
      literals into an EmailPalette, because ink that is correct on white is
      invisible on black — and this scan, which had measured them all, went
      from twelve matches to one without a word. The remaining literals are
      still measured below; the palettes are measured in the block after it,
      against their own grounds rather than against white.
    */
    expect(literals.length).toBeGreaterThanOrEqual(1);
  });

  for (const literal of literals) {
    it(`${literal}`, () => {
      const fg = parseHex(literal);
      expect(fg, `could not parse ${literal}`).not.toBeNull();
      for (const ground of GROUNDS) {
        const ratio = contrastRatio(fg!, parseHex(ground)!);
        expect(
          ratio,
          `${literal} measures ${ratio.toFixed(2)}:1 on ${ground} — the email's body text is 12-14px, so AA needs ${MIN_CONTRAST}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    });
  }
});

/**
 * Every palette's ink, against the ground that palette paints it on.
 *
 * This is the block the literal scan above became when the editorial layout
 * landed. The pairing is the point: #3c372f body text is 9.6:1 on white and
 * 1.2:1 on the editorial black, so a colour is not readable or unreadable on
 * its own — only on something.
 *
 * The bars differ, and the difference is a decision rather than an oversight:
 *
 *  - Light is held to AA (4.5). Its muted grey is 5.10:1 on the card and
 *    4.81:1 on the page, tuned in place on 11 Sep 2026 from a #a49a89 that
 *    measured 2.78:1. Raising the bar here would mean re-tuning a palette
 *    that is in front of real recipients, which is a change to make
 *    deliberately and not as a side effect of adding a layout.
 *  - Editorial is held to 7:1, because it was written from scratch on
 *    27 Sep 2026 and there is no reason for a new palette to be worse. The
 *    email it was modelled on rendered its launch time at roughly 2.5:1 on
 *    black, which is what this number is here to prevent.
 */
describe("every palette's ink clears its bar on its own ground", () => {
  const BARS: Record<keyof typeof PALETTES, number> = {
    plain: MIN_CONTRAST,
    branded: MIN_CONTRAST,
    editorial: 7,
  };

  it("there are palettes to measure", () => {
    // Same canary as above, for the same reason.
    expect(Object.keys(PALETTES).length).toBeGreaterThanOrEqual(2);
  });

  for (const [key, palette] of Object.entries(PALETTES)) {
    const bar = BARS[key as keyof typeof PALETTES];

    /*
      Which ink sits on which ground. Named rather than crossed, because a
      cross product would invent pairings the renderer never emits — the
      price never appears on the canvas in the branded layout, for instance,
      and failing on a pairing that cannot happen teaches people to widen the
      exemptions until the test says nothing.
    */
    const pairings: [string, string, string][] = [
      ["body copy", palette.ink, palette.surface],
      ["headlines and product names", palette.inkStrong, palette.surface],
      ["the unsubscribe and postal lines", palette.inkMuted, palette.surface],
      ["a product name on its card", palette.inkStrong, palette.productBg],
      ["a price on its card", palette.priceInk, palette.productBg],
    ];

    for (const [what, fg, bg] of pairings) {
      it(`${key}: ${what}`, () => {
        const ink = parseHex(fg);
        const ground = parseHex(bg);
        expect(ink, `${key}: ${fg} does not parse`).not.toBeNull();
        expect(ground, `${key}: ${bg} does not parse`).not.toBeNull();
        const ratio = contrastRatio(ink!, ground!);
        expect(
          ratio,
          `${key}: ${what} is ${fg} on ${bg}, which measures ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(bar);
      });
    }

    it(`${key}: the default accent survives being resolved against it`, () => {
      // emailAccent is what every link and product name goes through. On a
      // dark canvas it must LIGHTEN — the one behaviour that would fail
      // silently, as black-on-black.
      const resolved = parseHex(
        emailAccent(null, palette.accentOn, palette.accentMin),
      )!;
      const ground = parseHex(palette.accentOn)!;
      expect(contrastRatio(resolved, ground)).toBeGreaterThanOrEqual(
        palette.accentMin,
      );
      // And the palette's own bar is the one the rest of its ink is held to,
      // so a layout cannot quietly exempt its links from it.
      expect(palette.accentMin).toBeGreaterThanOrEqual(bar === 7 ? 7 : MIN_CONTRAST);
    });
  }
});

/**
 * The invite email, pairing by pairing.
 *
 * ── WHY A TABLE AND NOT A SCAN ──
 * The newsletter block above can scan for literals because that template has
 * exactly two grounds and every colour sits on one of them. This one has four
 * — the page, the white card, the brand orange and the address chip — so
 * "every colour against every ground" would invent pairings that do not exist
 * and fail on them.
 *
 * A hand-written table can drift from the markup instead, which is the usual
 * reason not to write one. So each entry asserts that BOTH of its colours are
 * still in the file: change a colour and the test fails rather than quietly
 * carrying on measuring one that is no longer there.
 *
 * Three of these failed when first measured, in the first email a new client
 * ever receives — including white on the brand orange at 4.04:1, on the button
 * the whole message exists to get pressed.
 */
describe("every pairing in the invite email clears AA", () => {
  const source = readFileSync(join(process.cwd(), "lib/email.ts"), "utf8");

  const PAIRINGS: { fg: string; bg: string; what: string; large?: boolean }[] = [
    { fg: "#26221d", bg: "#ffffff", what: "the heading and the bold business name" },
    { fg: "#5f594f", bg: "#ffffff", what: "the body copy at 14.5px" },
    { fg: "#ab441f", bg: "#f9e7de", what: "the inbox address chip at 14px" },
    { fg: "#ffffff", bg: "#c14d2a", what: "the Set up your inbox button at 15px" },
    { fg: "#746d61", bg: "#ffffff", what: "reply to this email, at 13px" },
    { fg: "#746d61", bg: "#faf8f4", what: "the Postbox footer line at 12px" },
  ];

  for (const { fg, bg, what, large } of PAIRINGS) {
    it(`${fg} on ${bg} — ${what}`, () => {
      // Both halves must still exist, or this is measuring a pairing the
      // template no longer has.
      expect(source, `${fg} is no longer in lib/email.ts`).toContain(fg);
      expect(source, `${bg} is no longer in lib/email.ts`).toContain(bg);

      const ratio = contrastRatio(parseHex(fg)!, parseHex(bg)!);
      const need = large ? 3 : MIN_CONTRAST;
      expect(
        ratio,
        `${fg} on ${bg} measures ${ratio.toFixed(2)}:1 — ${what} needs ${need}`,
      ).toBeGreaterThanOrEqual(need);
    });
  }

  it("the table still covers every colour the template uses", () => {
    /*
      The drift guard. A colour added to the email without a row above would
      otherwise never be measured — which is exactly how #a49a89 and #b3a999
      sat unmeasured beside an accent that had its own helper and its own test.
    */
    const used = new Set(
      [...source.matchAll(/(?:color|background):(#[0-9a-f]{6})/g)].map((m) => m[1]!),
    );
    const covered = new Set(PAIRINGS.flatMap((p) => [p.fg, p.bg]));
    const unmeasured = [...used].filter((c) => !covered.has(c));
    expect(unmeasured, "colours in lib/email.ts with no pairing in the table above").toEqual([]);
  });
});
