/**
 * Colour arithmetic for email HTML.
 *
 * Pure, and imports nothing — same constraint as lib/newsletter.ts, which is
 * its only caller. No database, no config, no env.
 *
 * ── WHY THIS IS NOT normaliseLabelHex FROM lib/labels.ts ──
 * They look like the same job and are the opposite one.
 *
 * A label chip lives in the app, where CSS can be trusted. It stores a hex,
 * keeps only its HUE, and lets `oklch(from var(--label-hex) …)` take lightness
 * from whichever of the six themes is active — so the contrast is decided at
 * paint time, by the theme, and the stored colour never has to be safe on its
 * own.
 *
 * An email has none of that. Relative colour syntax, custom properties and
 * `color-mix` are unsupported across Outlook, Gmail's web client and most of
 * Apple Mail's older renderers; there is no cascade to lean on and no second
 * chance once the message is sent. Whatever hex is written into the `style`
 * attribute is what a stranger reads, forever, on a background this file
 * already knows. So the contrast has to be BAKED IN at render time, in
 * TypeScript, which is what darkenToContrast does.
 *
 * Which means the two must not be merged. The label version deliberately
 * preserves a colour that would be unreadable if painted flat, because it is
 * never painted flat. Sharing it here would ship exactly that.
 */

export type Rgb = { r: number; g: number; b: number };

/**
 * Parse `#rgb` or `#rrggbb`. Null for anything else, including non-strings —
 * the value can arrive from a JSON body, so it can be anything at all.
 */
export function parseHex(raw: unknown): Rgb | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(value);
  const long = /^#([0-9a-f]{6})$/.exec(value);

  const digits = short
    ? short[1]!
        .split("")
        .map((c) => c + c)
        .join("")
    : long?.[1];
  if (!digits) return null;

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

export function toHex(c: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

/**
 * WCAG 2.1 relative luminance. The 0.03928 branch and the 2.4 exponent are
 * from the specification and are not a curve worth improvising on.
 */
export function relativeLuminance(c: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
  );
}

/** WCAG contrast, 1:1 to 21:1. Order of arguments does not matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for body-sized text, which is what a link in an email paragraph is. */
export const MIN_CONTRAST = 4.5;

/**
 * The nearest readable version of `accent` on `background`.
 *
 * ── THE PROBLEM THIS SOLVES ──
 * A client picks their brand colour. Brand colours are chosen to look good on
 * a shopfront, not to be legible as 14px link text on white, and plenty are
 * not: a bakery's pale yellow measures about 1.3:1 on white, which is invisible
 * rather than merely poor. Painting it as authored would mean the client sees
 * their colour in the composer and their customers see nothing.
 *
 * ── WHY SCALE RGB RATHER THAN ADJUST LIGHTNESS PROPERLY ──
 * Scaling all three channels toward black keeps the ratios between them, so
 * hue survives well enough to stay recognisably the client's colour, and it is
 * monotonic in luminance — which is what makes the search below correct rather
 * than approximate. A perceptual space would hold saturation better, but every
 * conversion is another 60 lines that must be right, in a file whose output
 * cannot be corrected after it is sent.
 *
 * Returns the ORIGINAL when it already passes, so a client who picked a
 * readable colour gets exactly what they chose, byte for byte.
 */
export function darkenToContrast(
  accent: Rgb,
  background: Rgb,
  minimum = MIN_CONTRAST,
): Rgb {
  if (contrastRatio(accent, background) >= minimum) return accent;

  const scale = (t: number): Rgb => ({
    r: accent.r * t,
    g: accent.g * t,
    b: accent.b * t,
  });

  /*
    Darkening only helps on a light background. Both shells in
    lib/newsletter.ts are light, but a future template on a dark ground would
    silently get black-on-black from a darkening-only version, so the other
    direction is handled rather than assumed away.
  */
  const towardsWhite = (t: number): Rgb => ({
    r: accent.r + (255 - accent.r) * t,
    g: accent.g + (255 - accent.g) * t,
    b: accent.b + (255 - accent.b) * t,
  });

  const direction =
    contrastRatio({ r: 0, g: 0, b: 0 }, background) >= minimum
      ? scale
      : towardsWhite;

  /*
    Binary search for the LEAST adjustment that passes — the endpoint (pure
    black, or pure white) always does, because a background cannot be within
    4.5:1 of both. 24 iterations resolves far finer than 1/255, so the result
    is exact to the byte.
  */
  let lo = 0; // maximum adjustment: guaranteed to pass
  let hi = 1; // no adjustment at all: known to fail
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = direction === scale ? scale(mid) : towardsWhite(1 - mid);
    if (contrastRatio(candidate, background) >= minimum) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const chosen = direction === scale ? scale(lo) : towardsWhite(1 - lo);

  /*
    Rounding to whole bytes can drop the ratio a hair below the threshold, so
    the rounded value is re-checked and stepped once more if it fails. Without
    this the function could return something that does not satisfy its own
    postcondition — which the tests assert across a sweep of hostile colours.
  */
  const rounded = parseHex(toHex(chosen))!;
  if (contrastRatio(rounded, background) >= minimum) return rounded;
  return parseHex(
    toHex(direction === scale ? scale(lo * 0.96) : towardsWhite(1 - lo * 0.96)),
  )!;
}
