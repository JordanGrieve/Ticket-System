import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINED_FIELDS, UNCHAINED_COLUMNS } from "../lib/impersonation-chain";

/**
 * A hash chain may not seal a column the DATABASE is allowed to rewrite.
 *
 * ── THE BUG THIS PINS ──
 *
 * `impersonation_sessions.workspace_id` and `.admin_id` were both sealed by
 * the chain (CHAINED_FIELDS) AND both carried
 * `references(...).onDelete("set null")`. Those two facts contradict each
 * other: the chain's entire claim is "nobody edited this row", and the schema
 * authorised Postgres to edit it.
 *
 * So on 11 Sep 2026 deleting the E2E Test Bakery workspace — through the
 * console's own type-the-name confirmation, recorded in admin_actions, exactly
 * as designed — nulled three sealed columns and the access log started
 * reporting "CHAIN BROKEN — a row has been deleted or edited" at session #59.
 * A tamper alarm firing on a legitimate first-party action is worse than no
 * alarm: it is the one that teaches an operator to ignore the real one.
 *
 * Both foreign keys are gone now (db/migrations/0029). The ids are frozen
 * snapshots, like `admin_actions.target_id`, which reached this conclusion
 * first. "Does that workspace still exist?" is answered by a join in
 * listImpersonationSessions, not by reading a null out of a sealed column.
 *
 * ── WHY THIS READS THE SCHEMA TEXT ──
 *
 * Because the defect was a PAIRING — each half was reasonable alone, and no
 * type or unit test can see the pair. The only place both facts appear is the
 * schema file and the chain's field list, so the assertion has to hold them up
 * against each other. Same instrument, and the same reason, as
 * tests/contrast-tokens.test.ts measuring a token against the ground it is
 * actually painted on.
 */

const SCHEMA = readFileSync(join(__dirname, "..", "db/schema.ts"), "utf8");

/** The `impersonationSessions` table definition, as source text. */
function sessionsTable(): string {
  const at = SCHEMA.indexOf('pgTable(\n  "impersonation_sessions"');
  expect(at, "impersonation_sessions is gone or its definition was reformatted")
    .toBeGreaterThan(-1);
  // To the start of the next pgTable, or the end of the file.
  const next = SCHEMA.indexOf("pgTable(", at + 10);
  return SCHEMA.slice(at, next === -1 ? SCHEMA.length : next);
}

/** camelCase field name → the snake_case column it maps to. */
function columnFor(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

describe("the impersonation chain seals only immutable columns", () => {
  const table = sessionsTable();

  it("seals the fields it says it seals", () => {
    // Guards the test itself: if the list is emptied or renamed, everything
    // below would pass vacuously.
    expect(CHAINED_FIELDS.length).toBeGreaterThan(3);
    expect(CHAINED_FIELDS).toContain("workspaceName");
    expect(CHAINED_FIELDS).toContain("adminEmail");
    expect(CHAINED_FIELDS).toContain("startedAt");
  });

  it("does NOT let any sealed column carry an onDelete rule", () => {
    /*
     * The assertion that would have caught it. For each sealed field, find its
     * column declaration and require that it does not hand Postgres permission
     * to rewrite it.
     */
    const offenders: string[] = [];
    for (const field of CHAINED_FIELDS) {
      const column = columnFor(field);
      const declAt = table.indexOf(`"${column}"`);
      if (declAt === -1) continue; // startedAt etc. are declared plainly.
      // The declaration runs to the end of its statement.
      const decl = table.slice(declAt, table.indexOf("\n", declAt) + 400);
      const upToNextField = decl.slice(0, decl.indexOf("),") + 2 || decl.length);
      if (/onDelete/.test(upToNextField)) offenders.push(`${field} (${column})`);
    }
    expect(
      offenders,
      "these columns are sealed by the hash chain AND the database is allowed " +
        "to rewrite them on delete, so a legitimate deletion reports as tampering",
    ).toEqual([]);
  });

  it("keeps the two ids free of foreign keys entirely", () => {
    // Narrower and blunter than the rule above, because these are the two that
    // actually did it and a reinstated `references(...)` is how it comes back.
    for (const column of ["admin_id", "workspace_id"]) {
      const at = table.indexOf(`"${column}"`);
      expect(at, `${column} is gone`).toBeGreaterThan(-1);
      const decl = table.slice(at, at + 160);
      expect(
        decl.includes("references("),
        `${column} has a foreign key again — see db/schema.ts and migration 0029`,
      ).toBe(false);
    }
  });

  it("still leaves the mutable lifecycle columns unsealed", () => {
    // The other half of the rule: endedAt and friends are written AFTER the
    // row is sealed, so sealing them would break every open session's hash the
    // moment it closed.
    for (const column of UNCHAINED_COLUMNS) {
      expect(CHAINED_FIELDS).not.toContain(column);
    }
  });
});

describe("the identity survives a deletion without the id", () => {
  it("seals a frozen name and email beside each id", () => {
    // This is what makes dropping the ids from the UI safe: the row still says
    // who it was and which workspace, in columns nothing ever rewrites.
    const table = sessionsTable();
    expect(table).toContain('text("workspace_name").notNull()');
    expect(table).toContain('text("admin_email").notNull()');
    expect(CHAINED_FIELDS).toContain("workspaceName");
    expect(CHAINED_FIELDS).toContain("adminEmail");
  });
});
