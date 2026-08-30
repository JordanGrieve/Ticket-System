import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normaliseLabelHex } from "../lib/labels";

/**
 * The colour a user picks for a label.
 *
 * normaliseLabelHex guards the ONE field on a label that reaches a CSS custom
 * property on the element. Whatever it lets through is interpolated into a
 * style attribute, so it is strict by design — and everything it rejects falls
 * back to the theme token, which always renders. There is no failure mode
 * where a label ends up invisible because its colour was refused.
 */

describe("what counts as a colour", () => {
  it("accepts a six-digit hex and lowercases it", () => {
    expect(normaliseLabelHex("#AABBCC")).toBe("#aabbcc");
    expect(normaliseLabelHex("  #8b6bff  ")).toBe("#8b6bff");
  });

  it("expands three-digit shorthand", () => {
    // Every native colour input emits six digits, but #f00 is a reasonable
    // thing for a person to mean and cheap to accept.
    expect(normaliseLabelHex("#f00")).toBe("#ff0000");
  });

  it("refuses anything that is not a hex colour", () => {
    /*
     * Each of these is valid CSS colour syntax somewhere, and each is a real
     * way to get something other than a colour into a style attribute. The
     * input is a native colour picker, so none of them can arrive from the UI
     * — they arrive from somebody posting to the API directly.
     */
    expect(normaliseLabelHex("red")).toBeNull();
    expect(normaliseLabelHex("rgb(255,0,0)")).toBeNull();
    expect(normaliseLabelHex("var(--nav)")).toBeNull();
    expect(normaliseLabelHex("url(https://example.invalid/x.png)")).toBeNull();
    expect(normaliseLabelHex("#ff0000; background: url(x)")).toBeNull();
  });

  it("refuses a hex of the wrong length or shape", () => {
    expect(normaliseLabelHex("#ff00")).toBeNull();
    expect(normaliseLabelHex("#ff000000")).toBeNull();
    expect(normaliseLabelHex("ff0000")).toBeNull();
    expect(normaliseLabelHex("#gggggg")).toBeNull();
  });

  it("refuses non-strings without throwing", () => {
    // It reads a JSON body, so the value can be anything at all.
    expect(normaliseLabelHex(null)).toBeNull();
    expect(normaliseLabelHex(undefined)).toBeNull();
    expect(normaliseLabelHex(42)).toBeNull();
    expect(normaliseLabelHex({})).toBeNull();
    expect(normaliseLabelHex([])).toBeNull();
  });
});

describe("a picked colour never decides its own contrast", () => {
  /*
   * lib/labels.ts recorded the objection to ever offering a colour wheel: the
   * column stores a token because a token resolves per palette, and a flat hex
   * cannot — dark navy would be unreadable on Ocean, pale yellow unreadable on
   * Light.
   *
   * The answer is relative colour syntax. The chip keeps ONLY the hue of what
   * was chosen and takes its lightness from tokens each theme sets for itself,
   * so the colour is recognisably theirs and the contrast is not theirs to get
   * wrong.
   *
   * ── THE FIRST VERSION OF THIS FAILED, AND THAT IS WHY THESE EXIST ──
   * It began as color-mix toward --surface and --text, which reads as the same
   * idea. Painting four hostile picks across all five palettes and reading the
   * pixels back gave a worst case of 1.14:1 — pure black on Ocean, invisible —
   * because mixing preserves too much of the pick's own lightness on a dark
   * ground. Fixing the lightness instead measured 6.65:1 at worst, with every
   * combination passing AA.
   *
   * If any of this reverts to painting the hex directly, that regression is
   * silent on screen for whoever changed it and obvious to somebody on another
   * theme. These tests are how it gets caught first.
   */
  const CSS = readFileSync(join(process.cwd(), "app/mail.css"), "utf8");
  const rule = CSS.slice(CSS.indexOf(".pbm-label[data-custom]"));
  const block = rule.slice(0, rule.indexOf("}"));

  it("takes the ground's lightness from the theme, not from the pick", () => {
    expect(block).toContain(
      "background: oklch(from var(--label-hex) var(--label-bg-l)",
    );
  });

  it("takes the ink's lightness from the theme too", () => {
    expect(block).toContain(
      "color: oklch(from var(--label-hex) var(--label-fg-l)",
    );
  });

  it("keeps only the hue of what was chosen", () => {
    // The trailing `h` is the whole mechanism: lightness and chroma are ours.
    expect(block).toMatch(/ h\)/);
  });

  it("never paints the raw hex as a background", () => {
    expect(block).not.toMatch(/background:\s*var\(--label-hex\)\s*;/);
  });

  it("every theme sets its own label lightness", () => {
    // Five palettes plus the system-dark fallback. A theme missing these would
    // inherit the light values and paint a pale chip on a dark ground.
    const G = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect((G.match(/--label-bg-l:/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((G.match(/--label-fg-l:/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("keeps a token fallback on every custom chip", () => {
    // labelChipProps sets data-color alongside data-custom, so a chip whose
    // hex fails to parse in some future browser still has a colour.
    const HELPER = readFileSync(
      join(process.cwd(), "components/mail/label-style.ts"),
      "utf8",
    );
    expect(HELPER).toMatch(
      /"data-color": label\.color,\s*\n\s*"data-custom": true/,
    );
  });
});
