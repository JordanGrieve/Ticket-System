import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every production call of renderCampaign says what image and what products
 * it is rendering.
 *
 * ── WHY THIS EXISTS ──
 * `hero` and `products` are optional on renderCampaign, and correctly so: it
 * is a pure function and "not given" means "none", which is what the unit
 * tests assert by omitting them. Optional in the RENDERER turned out to mean
 * forgotten at the CALLER, twice, and both shipped:
 *
 *  1. The campaign test send — the endpoint whose entire purpose is showing a
 *     client what real recipients will get — rendered without either, so it
 *     previewed a different email from the one that would be sent.
 *  2. The composer preview and the send loop each had to be wired separately,
 *     and nothing connected them.
 *
 * Neither is a type error and neither changes any output the unit tests look
 * at: the renderer does exactly what it was asked. The only place the mistake
 * is visible is the call site, so that is what this reads.
 *
 * A caller with genuinely neither says so — `hero: null, products: []`, as
 * lib/welcome.ts does. The point is that leaving them out is never silent.
 */

const DIRS = ["lib", "app"];

/** The file that DEFINES renderCampaign, which naturally does not call it. */
const DEFINITION = join("lib", "newsletter.ts");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * The text of one call's argument, from the opening brace to its match.
 *
 * Brace counting rather than a pattern: the argument contains nested objects
 * and arrow functions several levels deep, and anything that stops at the
 * first closing brace would read two lines of a twenty-line call and report
 * whatever it found there.
 */
function callArguments(src: string, at: number): string {
  // The brace must be the argument's own, so skip only whitespace after the
  // parenthesis. Scanning ahead for the next "{" anywhere reported the prose
  // mention of "renderCampaign()" in the composer's header comment as a call,
  // and handed back a block eight hundred lines further down — a false
  // failure that read exactly like a real one.
  let open = at;
  while (open < src.length && /\s/.test(src[open]!)) open += 1;
  if (src[open] !== "{") return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

type Call = { file: string; index: number; args: string };

function callsIn(file: string): Call[] {
  const src = readFileSync(file, "utf8");
  const calls: Call[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf("renderCampaign(", from);
    if (at === -1) break;
    from = at + 1;
    // `renderCampaign` also appears in prose and in imports. Only a call with
    // an object argument is one of these call sites.
    const args = callArguments(src, at + "renderCampaign(".length);
    if (args.startsWith("{")) calls.push({ file, index: at, args });
  }
  return calls;
}

describe("every production renderCampaign call names its image and products", () => {
  const files = DIRS.flatMap((d) => sourceFiles(d)).filter(
    (f) => f !== DEFINITION,
  );

  const calls = files.flatMap((f) => callsIn(f));

  it("found the call sites", () => {
    // The canary. A rename, a moved file or a broken brace matcher would
    // otherwise make every assertion below pass by finding nothing.
    expect(
      calls.length,
      "no renderCampaign calls found under lib/ or app/ — this test is measuring nothing",
    ).toBeGreaterThanOrEqual(3);
  });

  it("passes hero at every call site", () => {
    const missing = calls
      .filter((c) => !c.args.includes("hero:"))
      .map((c) => c.file);
    expect(
      missing,
      "these render a campaign without saying what image it carries; pass `hero: null` if it has none",
    ).toEqual([]);
  });

  it("passes products at every call site", () => {
    const missing = calls
      .filter((c) => !c.args.includes("products:"))
      .map((c) => c.file);
    expect(
      missing,
      "these render a campaign without saying what products it carries; pass `products: []` if it has none",
    ).toEqual([]);
  });
});
