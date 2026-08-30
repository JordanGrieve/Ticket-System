import { describe, it, expect } from "vitest";
import {
  parseHex,
  toHex,
  contrastRatio,
  darkenToContrast,
  MIN_CONTRAST,
} from "../lib/email-colour";

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
