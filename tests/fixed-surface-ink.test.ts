import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A surface that does NOT follow the theme must not carry ink that does.
 *
 * ── THE MISTAKE THIS CATCHES ──
 * On 11 September 2026 `--nav` stopped being a fixed near-black and became
 * the navigation surface, per theme. The dark panels that had been borrowing
 * it — the marketing hero and closing band, the product shots, the install
 * page's code block — moved to `--brand-panel`, which stays dark in both.
 *
 * The code block moved its BACKGROUND and kept its ink: `color:
 * var(--nav-badge-fg)`, which in light is now #3f2b93. Dark purple text on a
 * #1c1830 block. Nothing failed — both tokens exist, both parse, the
 * stylesheet is valid, and the contrast-token guard measures each token
 * against the ground it is DECLARED for, not the one a rule actually paints
 * it on.
 *
 * So this reads the rules themselves: inside any block that paints
 * `--brand-panel*`, every colour must be fixed too — a literal, or one of the
 * `--brand-panel*` inks. The reverse case (fixed ink on a themed surface) is
 * the same bug upside down and is checked with it.
 */

const ROOT = join(__dirname, "..");

/** Tokens that are the same in both palettes, by definition. */
const FIXED = /var\(--brand-panel[a-z-]*\)/;
/** Tokens that flip with the theme. The nav family is the one that moved. */
const THEMED = /var\(--(nav|text|muted|surface|border|accent)[a-z0-9-]*/;

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

type Rule = { file: string; selector: string; body: string };

/**
 * Every declaration block in a stylesheet, as text.
 *
 * Brace counting rather than a CSS parse: media queries nest, and a nested
 * block's declarations belong to the inner rule, which is what this needs to
 * see. Comments are stripped first so a token NAMED in prose is not read as a
 * declaration — the palette file discusses these tokens at length.
 */
function rules(file: string): Rule[] {
  const raw = readFileSync(file, "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  let depth = 0;
  let start = -1;
  let selectorAt = 0;
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === "{") {
      depth += 1;
      if (depth === 1) {
        start = i;
        selectorAt = src.lastIndexOf("}", i) + 1;
      }
    } else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        found.push({
          file,
          selector: src.slice(selectorAt, start).trim().replace(/\s+/g, " ").slice(0, 80),
          body: src.slice(start + 1, i),
        });
        start = -1;
      }
    }
  }
  return found;
}

describe("ink matches the surface it is painted on", () => {
  const files = [...cssFiles(join(ROOT, "app")), ...cssFiles(join(ROOT, "components"))];

  it("found the stylesheets", () => {
    // The canary. A moved directory would otherwise make this pass by
    // scanning nothing — the failure mode this repo has hit before.
    expect(files.length).toBeGreaterThan(10);
  });

  /**
   * The selectors that paint the fixed panel, across every stylesheet.
   *
   * Collected first, because the ink is usually on a CHILD rule: `.sti-code`
   * carries the background and `.sti-code pre` carries the colour. The first
   * version of this test looked for both in ONE block, so it could not see
   * the exact bug it was written for — it passed with the broken code in
   * place, and only the deliberate break showed that.
   */
  const panelSelectors = files.flatMap((file) =>
    rules(file)
      .filter((r) => /background[a-z-]*:[^;]*var\(--brand-panel/.test(r.body))
      .map((r) => r.selector),
  );

  it("found the surfaces that paint the fixed panel", () => {
    expect(
      panelSelectors.length,
      "nothing paints --brand-panel — either it was renamed or this is measuring nothing",
    ).toBeGreaterThan(2);
  });

  it("a --brand-panel surface never carries themed ink, itself or in its children", () => {
    const bad: string[] = [];
    for (const file of files) {
      for (const rule of rules(file)) {
        const inside = panelSelectors.some(
          (panel) => rule.selector === panel || rule.selector.startsWith(panel + " "),
        );
        if (!inside) continue;
        const colour = rule.body.match(/(?:^|[;{])\s*color:\s*([^;]+)/);
        if (!colour) continue;
        if (THEMED.test(colour[1]!) && !FIXED.test(colour[1]!)) {
          bad.push(`${file.replace(ROOT, "")} — ${rule.selector} → color: ${colour[1]!.trim()}`);
        }
      }
    }
    expect(
      bad,
      "these sit on a fixed dark panel and take their ink from a token that flips with the theme",
    ).toEqual([]);
  });

  it("a --brand-panel ink is never painted on a themed surface", () => {
    const bad: string[] = [];
    for (const file of files) {
      for (const rule of rules(file)) {
        const inkIsFixed = /(?:^|[;{])\s*color:\s*[^;]*var\(--brand-panel/.test(rule.body);
        if (!inkIsFixed) continue;
        const bg = rule.body.match(/(?:^|[;{])\s*background(?:-color)?:\s*([^;]+)/);
        if (!bg) continue;
        if (THEMED.test(bg[1]!) && !FIXED.test(bg[1]!)) {
          bad.push(`${file.replace(ROOT, "")} — ${rule.selector} → background: ${bg[1]!.trim()}`);
        }
      }
    }
    expect(bad, "fixed ink on a surface that flips is the same bug upside down").toEqual([]);
  });
});
