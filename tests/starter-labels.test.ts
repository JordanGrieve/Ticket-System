import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LABEL_COLORS, STARTER_LABELS } from "../lib/labels";

/**
 * The labels a brand new workspace starts with.
 *
 * The list itself is pure and can be asserted directly. The one thing that is
 * not — that provisioning cannot FAIL because of them — is checked against the
 * source, same technique as the other guards here: every test in this repo
 * runs without DATABASE_URL.
 */

describe("starter labels", () => {
  it("gives a new workspace something rather than an empty picker", () => {
    expect(STARTER_LABELS.length).toBeGreaterThan(0);
  });

  it("uses only real colour tokens", () => {
    // A label whose colour is not a token renders unstyled: the paint comes
    // from [data-color] rules that resolve --tag-*-bg / --tag-*-fg, and a key
    // with no rule behind it gets nothing at all.
    for (const l of STARTER_LABELS) {
      expect(LABEL_COLORS).toContain(l.color);
    }
  });

  it("has no duplicate names", () => {
    // The unique index is (workspace_id, name), so a duplicate here would
    // silently produce fewer labels than the list claims.
    const names = STARTER_LABELS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not name anything one trade would keep and another would delete", () => {
    // "Wholesale" was in the research's list and is deliberately not here: it
    // fits a bakery and not a plumber, and a default half our clients delete
    // is the clutter that makes people distrust the rest of the defaults.
    const names = STARTER_LABELS.map((l) => l.name.toLowerCase());
    expect(names).not.toContain("wholesale");
  });
});

describe("starter labels cannot cost somebody their workspace", () => {
  const src = readFileSync(join(process.cwd(), "lib", "workspace.ts"), "utf8");

  it("provisionWorkspace seeds them inside a try/catch", () => {
    /*
      The workspace row and the first agent row are already committed when the
      seed runs, and neon-http gives no transaction to unwind them with. An
      unguarded throw would leave a real, usable workspace behind an error
      screen — over three decorative rows.
    */
    const start = src.indexOf("export async function provisionWorkspace");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n/**", start));

    const call = body.indexOf("seedStarterLabels(");
    expect(call, "provisionWorkspace no longer seeds starter labels").toBeGreaterThan(-1);

    const tryAt = body.lastIndexOf("try {", call);
    expect(
      tryAt,
      "seedStarterLabels is not wrapped in try/catch. A failure there would " +
        "put a committed workspace behind an error screen.",
    ).toBeGreaterThan(-1);
    expect(body.slice(call).indexOf("} catch")).toBeGreaterThan(-1);
  });

  it("seeds after the workspace and agent rows exist, not before", () => {
    const start = src.indexOf("export async function provisionWorkspace");
    const body = src.slice(start, src.indexOf("\n/**", start));
    expect(body.indexOf("insert(agents)")).toBeLessThan(
      body.indexOf("seedStarterLabels("),
    );
  });
});
