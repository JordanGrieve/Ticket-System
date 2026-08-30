import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every CSS custom property that is used is defined somewhere.
 *
 * ── WHY THIS IS NOT PEDANTRY ──
 * An undefined `var()` does not fall back and does not warn. It makes the
 * WHOLE declaration invalid at computed-value time, so the property resolves
 * to its initial value — and a rule that quietly does nothing looks exactly
 * like a rule that was never needed.
 *
 * Three real ones were shipped and live for weeks before this test existed:
 *
 *   .pba-navrow.is-active .pba-dot { background: var(--nav-active-dot) }
 *   .pba-pill-ok               { background: var(--ok-bg); … }
 *   .pba-banner-ok             { background: var(--ok-bg); … }
 *
 * Neither token was defined anywhere. So the operator console's "you are here"
 * dot stayed the same grey as an inactive one, and its success pills and
 * banners rendered with no background at all while the green ink beside them
 * worked perfectly — which is precisely why nobody spotted it.
 *
 * Found by auditing for this pattern after an undefined var() nearly caused a
 * FALSE diagnosis in the other direction: the UI harness reported a missing
 * box-shadow on the sidebar plan card, and the cause turned out to be the
 * harness rendering the card outside the `.pbm` scope that defines the token.
 * Both directions of that confusion are cheap to prevent and expensive to
 * debug, so they are prevented here.
 */

const ROOT = process.cwd();

function cssFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/node_modules|\.next|\.git/.test(full)) continue;
        walk(full);
      } else if (entry.name.endsWith(".css")) {
        out.push(full);
      }
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));
  return out;
}

/**
 * Properties supplied at RUNTIME rather than by a stylesheet, with the source.
 *
 * An allowlist rather than a rule, because "not in any .css file" is exactly
 * what a genuine bug looks like too. Anything added here needs a reason a
 * reader can check.
 */
const RUNTIME_DEFINED: Record<string, string> = {
  "--font-jakarta":
    "next/font in app/layout.tsx — Plus_Jakarta_Sans({ variable }) puts it on <html> via className.",
  "--font-spline-mono":
    "next/font in app/layout.tsx — Spline_Sans_Mono({ variable }), same mechanism.",
  "--label-hex":
    "Set inline per element by labelChipProps in components/mail/label-style.ts, and only on chips that carry data-custom.",
};

describe("CSS custom properties", () => {
  const files = cssFiles();
  const defined = new Set<string>();
  const bare = new Map<string, Set<string>>();

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]!);
    for (const m of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
      // A var() WITH a fallback still renders if the token is missing, so it
      // cannot silently void a declaration. Only bare uses are checked.
      if (m[2]) continue;
      if (!bare.has(m[1]!)) bare.set(m[1]!, new Set());
      bare.get(m[1]!)!.add(file.replace(ROOT, "").split("\\").join("/"));
    }
  }

  it("finds the stylesheets at all", () => {
    // Otherwise every assertion below passes by looking at nothing.
    expect(files.length).toBeGreaterThan(10);
    expect(defined.size).toBeGreaterThan(50);
    expect(bare.size).toBeGreaterThan(20);
  });

  it("every bare var() names a property something defines", () => {
    const missing = [...bare.keys()]
      .filter((t) => !defined.has(t) && !(t in RUNTIME_DEFINED))
      .map((t) => `${t} (used in ${[...bare.get(t)!].join(", ")})`);

    expect(
      missing,
      "These are used as a bare var() and defined nowhere. An undefined var() " +
        "invalidates the WHOLE declaration, so each of these rules silently " +
        "does nothing. Define the property, or give the use a fallback.",
    ).toEqual([]);
  });

  it("the runtime allowlist is still accurate", () => {
    for (const [token, why] of Object.entries(RUNTIME_DEFINED)) {
      // If one of these ever gains a stylesheet definition, it should leave
      // the allowlist rather than sit here claiming to be runtime-only.
      expect(defined.has(token), `${token} is now defined in CSS`).toBe(false);
      expect(why.length).toBeGreaterThan(30);
    }
  });
});
