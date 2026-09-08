import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Text must be sized in rem, everywhere.
 *
 * ── WHAT WENT WRONG ──
 * Every font-size in this product was a hard px value: 374 of them across 20
 * stylesheets, plus 19 more as inline React style objects. px ignores the
 * root, so a reader who sets their browser's font size to "Very large" got
 * NOTHING — measured on 7 Sep 2026 by doubling the root on the live homepage,
 * where `p` stayed at 13px, `span` at 12.5px and the h1 at 38px while the root
 * went 16px -> 32px. The only thing that moved was an `li` that had no
 * font-size of its own to ignore it with.
 *
 * That is not a hard failure of 1.4.4 — full-page zoom still worked, and the
 * criterion is usually read as satisfied by that — but text-only resizing is
 * the setting low-vision readers on desktop actually use, and it did nothing
 * at all here.
 *
 * The conversion preserved every computed value exactly (12.5px is 0.78125rem,
 * a clean binary fraction, so nothing was rounded) and three dense pages were
 * measured before and after to confirm the tallies were byte-identical. The
 * change is invisible at the default setting and total at any other.
 *
 * ── WHY A SOURCE SCAN AND NOT A BROWSER CHECK ──
 * Both exist. __textZoom() in tests/audit-probes.js measures the live result
 * and reports anything that failed to grow, which is the real test. This is
 * the cheap one that runs in CI on every commit and names the file and line,
 * so a px value is caught when it is written rather than at the next sweep.
 *
 * It also catches what the sweep cannot: a rule on a screen no harness renders.
 */

const SKIP_FILES = new Set([
  /*
    Rendered by satori into a PNG for social previews, not by a browser into a
    page. There is no root font-size and no reader setting to honour, and rem
    is meaningless there. Its px values are correct.
  */
  "app/opengraph-image.tsx",
]);

function walk(dir: string, ext: string, found: string[] = []): string[] {
  for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, ext, found);
    else if (e.name.endsWith(ext) && !SKIP_FILES.has(rel)) found.push(rel);
  }
  return found;
}

describe("text is sized in rem so a reader can enlarge it", () => {
  it("no stylesheet declares a font-size in px", () => {
    const files = [...walk("app", ".css"), ...walk("components", ".css")];
    // The canary. A scan that found no files would pass while checking nothing.
    expect(files.length, "no stylesheets found").toBeGreaterThan(15);

    const offenders: string[] = [];
    let declarations = 0;

    for (const file of files) {
      const lines = readFileSync(join(process.cwd(), file), "utf8").split("\n");
      lines.forEach((line, i) => {
        // Strip single-line comments so prose about px does not trip this.
        const code = line.replace(/\/\*.*?\*\//g, "");
        const m = /font-size:\s*([^;}]+)/.exec(code);
        if (!m) return;
        declarations++;
        if (/\d\s*px/.test(m[1])) {
          offenders.push(`${file}:${i + 1}  font-size: ${m[1].trim()}`);
        }
      });
    }

    expect(declarations, "no font-size declarations were scanned").toBeGreaterThan(300);
    expect(offenders, "font-size in px — use rem so the root can scale it").toEqual([]);
  });

  it("no component sets an inline font-size in px", () => {
    const files = [...walk("app", ".tsx"), ...walk("components", ".tsx")];
    expect(files.length, "no components found").toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(join(process.cwd(), file), "utf8").split("\n");
      lines.forEach((line, i) => {
        /*
          A bare number is the trap, because React silently appends "px":
          `fontSize: 24` and `fontSize: "24px"` are the same thing rendered,
          and the first does not look like a unit at all. Both are caught.
        */
        const m = /fontSize:\s*(\d[\d.]*)\b(?!\s*\/)|fontSize:\s*["'`](\d[\d.]*px)["'`]/.exec(line);
        if (m) offenders.push(`${file}:${i + 1}  ${(m[1] ?? m[2]).trim()}`);
      });
    }

    expect(offenders, "inline fontSize in px — React appends px to a number").toEqual([]);
  });
});
