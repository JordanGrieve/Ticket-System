import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Which tables nothing uses yet, declared rather than discovered.
 *
 * ── THE PROBLEM THIS SOLVES ──
 * A table waiting for a feature and a table nobody wants look identical in
 * db/schema.ts: both are declared, neither is referenced. So "are these dead?"
 * could only be answered by asking whoever wrote them, and the answer decayed
 * as soon as they forgot.
 *
 * Declaring it makes the difference legible, and pins it in both directions:
 *
 *  1. A declared-unused table that gains a reader or writer fails here. That is
 *     the moment to decide whether it is tenant-scoped, whether the sweep in
 *     tests/tenancy-invariants.test.ts should be policing it, and whether the
 *     comment on it is still true.
 *  2. A table nothing uses that is NOT declared fails here too, so the next
 *     unused table has to be classified rather than quietly joining the pile.
 *
 * Neither of the current two is dead. Both are unbuilt features with the design
 * thinking already in their columns, which is exactly why dropping them would
 * be the expensive choice — they would only be rebuilt later, worse.
 */

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Tables no application code touches yet. The reason belongs beside the table
 * in db/schema.ts, not here — this list is the assertion, that is the record.
 */
const DECLARED_UNUSED = ["attachments", "sendingDomains"];

/**
 * Files that may legitimately NAME a table without using it.
 *
 * Kept to a list rather than made clever. Teaching the detector to ignore
 * string literals would be a small parser, and a small parser is a thing that
 * is subtly wrong in a way nobody notices — which is precisely the failure this
 * file exists to prevent.
 */
const EXEMPT_FILES = [
  // Where they are declared.
  "db/schema.ts",
  // The operator console's "nothing about delivery is measured yet" pane names
  // these tables in PROSE, to explain to an operator why the numbers are blank.
  // Naming a table in a sentence is not using it.
  "app/(admin)/admin/sections.tsx",
];

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out.map((p) => p.slice(ROOT.length + 1).split("\\").join("/"));
}

type Table = {
  /** The Drizzle export, e.g. `ticketStars`. */
  export: string;
  /** The SQL name, e.g. `ticket_stars`. */
  sql: string;
};

/** Every `export const <name> = pgTable("<sql_name>"` in the schema. */
function declaredTables(): Table[] {
  const schema = read("db/schema.ts");
  return [
    ...schema.matchAll(
      /export const (\w+) = pgTable\(\s*["'`]([a-z_]+)["'`]/g,
    ),
  ].map((m) => ({ export: m[1], sql: m[2] }));
}

/**
 * Which files use this table.
 *
 * BOTH names are checked, and the second one is the whole point. A first
 * version looked only for the Drizzle export and reported ticket_stars,
 * ticket_reads, ingestion_failures and rate_limits as unused — every one of
 * them is queried constantly, through raw `sql\`…\`` statements that name the
 * table in snake_case and never touch the export. A detector that only sees
 * one of the two ways this codebase talks to Postgres would have declared four
 * live tables dead.
 */
function usedInAppCode(table: Table): string[] {
  const byExport = new RegExp(`\\b${table.export}\\b`);
  const bySqlName = new RegExp(`\\b${table.sql}\\b`);
  return [...sourcesUnder("app"), ...sourcesUnder("lib"), ...sourcesUnder("db")]
    .filter((f) => !EXEMPT_FILES.includes(f))
    .filter((f) => {
      const src = read(f);
      return byExport.test(src) || bySqlName.test(src);
    });
}

/** Look a declared-unused name up in the schema. */
function tableFor(name: string): Table {
  const found = declaredTables().find((t) => t.export === name);
  if (!found) throw new Error(`${name} is in DECLARED_UNUSED but not in db/schema.ts`);
  return found;
}

describe("tables nothing uses are declared, not discovered", () => {
  it("every declared-unused table really is unused", () => {
    // If this fails, something started using the table. Update DECLARED_UNUSED,
    // and while you are there check tests/tenancy-invariants.test.ts is
    // policing it — an unused table's statements have never been reviewed.
    for (const table of DECLARED_UNUSED) {
      expect(
        usedInAppCode(tableFor(table)),
        `${table} is declared unused but is referenced by these files. ` +
          "Remove it from DECLARED_UNUSED and confirm its tenancy is enforced.",
      ).toEqual([]);
    }
  });

  it("every unused table is declared", () => {
    const unused = declaredTables().filter(
      (t) => usedInAppCode(t).length === 0,
    );
    const undeclared = unused
      .map((t) => t.export)
      .filter((name) => !DECLARED_UNUSED.includes(name));

    expect(
      undeclared,
      `Table(s) nothing uses that are not declared: ${undeclared.join(", ")}. ` +
        "Add each to DECLARED_UNUSED with a comment on the table in " +
        "db/schema.ts saying what it is waiting for — or delete it. A table " +
        "that is merely forgotten is indistinguishable from one that is " +
        "planned, which is the confusion this test exists to prevent.",
    ).toEqual([]);
  });

  it("the declared-unused tables still exist in the schema", () => {
    // Guards the list going stale the other way: a table dropped from the
    // schema should be dropped from here too, not left asserting about
    // something that no longer exists.
    const declared = declaredTables().map((t) => t.export);
    for (const table of DECLARED_UNUSED) {
      expect(declared, table + " is in DECLARED_UNUSED but not in the schema").toContain(table);
    }
  });

  it("each one says in the schema what it is waiting for", () => {
    // The list above is the assertion; the reasoning has to live next to the
    // table, where somebody reading the schema will actually find it.
    const schema = read("db/schema.ts");
    for (const table of DECLARED_UNUSED) {
      const at = schema.indexOf(`export const ${table} = pgTable(`);
      expect(at).toBeGreaterThan(-1);
      // The doc comment immediately above it.
      const preamble = schema.slice(Math.max(0, at - 1600), at);
      expect(
        preamble,
        `${table} has no "NOTHING READS OR WRITES THIS YET" note in db/schema.ts`,
      ).toMatch(/NOTHING READS OR WRITES THIS YET/);
    }
  });
});
