import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every page's title is right once the root template has been applied.
 *
 * app/layout.tsx sets `template: "%s — Postbox"`, so a page names only itself.
 * Eleven signed-in pages also wrote "· Postbox" into their own title and
 * rendered as "Newsletters · Postbox — Postbox". Five more set no title at
 * all and inherited the marketing headline, which says nothing about the
 * screen (2.4.2).
 *
 * Parallel-route slots (a folder starting with "@") are skipped: the title
 * comes from the page they render beside.
 */

const APP = join(process.cwd(), "app");

function pages(dir = APP): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("@") || entry.name === "api") continue;
      out.push(...pages(full));
    } else if (entry.name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

const ALL = pages().map((file) => ({
  name: relative(APP, file).split("\\").join("/"),
  source: readFileSync(file, "utf8"),
}));

const SIGNED_IN = ALL.filter(
  (p) => p.name.startsWith("(dashboard)/") || p.name.startsWith("(admin)/"),
);

describe("page titles", () => {
  it("found the pages", () => {
    expect(ALL.length).toBeGreaterThan(30);
    expect(SIGNED_IN.length).toBeGreaterThan(15);
  });

  it("no page repeats the suffix the root template adds", () => {
    const doubled = ALL.filter((p) =>
      /title:\s*["'`][^"'`]*Postbox["'`]/.test(p.source),
    ).map((p) => p.name);
    expect(doubled).toEqual([]);
  });

  it("every signed-in page names itself", () => {
    const untitled = SIGNED_IN.filter(
      (p) => !/export (const metadata|async function generateMetadata)\b/.test(p.source),
    ).map((p) => p.name);
    expect(untitled).toEqual([]);
  });
});
