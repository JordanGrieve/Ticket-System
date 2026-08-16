import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { labels, contacts } from "../db/schema";

/**
 * Tenancy invariants for the tables that carry NO workspace_id.
 *
 * ticket_labels, ticket_stars, ticket_reads, attachments, list_subscribers and
 * campaign_recipients inherit tenancy through a parent row. That makes every
 * statement touching them a potential cross-tenant leak the type system cannot
 * see: forget to join up to the parent and filter, and the query silently
 * spans every client on the platform.
 *
 * There is no DB mocking in this repo and CI has no DATABASE_URL, so these
 * tests work two ways that need neither:
 *
 *  1. STATIC — read the shipped source and assert every raw statement that
 *     mutates or reads a parentless table also constrains workspace_id. This
 *     guards the real code, not a reconstruction of it.
 *  2. DIALECT — render SQL through Drizzle's own pg-core Query
 *     Builder (no connection is ever opened) to pin the column-qualification
 *     behaviour that one of these queries depends on for correctness.
 */

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Tables with no workspace_id of their own — tenancy comes from a parent. */
const PARENTLESS = [
  "ticket_labels",
  "ticket_stars",
  "ticket_reads",
  "attachments",
  "list_subscribers",
  "campaign_recipients",
];

/**
 * Pull raw SQL template literals out of a source file: everything inside a
 * sql`...` tag. These are the statements Drizzle passes through verbatim, so
 * they are the ones no query builder is checking for us.
 */
function rawSqlStatements(source: string): string[] {
  const out: string[] = [];
  const re = /sql`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

/** Which parentless tables a statement mentions. */
function parentlessTablesIn(stmt: string): string[] {
  return PARENTLESS.filter((t) => new RegExp(`\\b${t}\\b`).test(stmt));
}

describe("parentless tables are never touched without a workspace filter", () => {
  const files = ["lib/data.ts", "lib/labels.ts"];

  /**
   * A static guard that matches nothing is worse than no guard, because it
   * reports green forever. Prove the detector works on fixtures, and prove it
   * is actually finding statements in the real source, before trusting it.
   */
  it("the detector itself flags an unscoped statement and clears a scoped one", () => {
    const bad = `
      INSERT INTO ticket_stars (ticket_id, agent_id)
      VALUES (\${ticketId}, \${agentId})
    `;
    const good = `
      INSERT INTO ticket_stars (ticket_id, agent_id)
      SELECT t.id, \${agentId} FROM tickets t
      WHERE t.id = \${ticketId} AND t.workspace_id = \${workspaceId}
    `;
    expect(parentlessTablesIn(bad)).toContain("ticket_stars");
    expect(/workspace_id\s*=/.test(bad)).toBe(false); // would be reported
    expect(parentlessTablesIn(good)).toContain("ticket_stars");
    expect(/workspace_id\s*=/.test(good)).toBe(true); // would pass
  });

  it("finds the real raw statements it is meant to be policing", () => {
    const touching = files
      .flatMap((f) => rawSqlStatements(read(f)))
      .filter((s) => parentlessTablesIn(s).length > 0);
    // ticket_stars insert+delete, ticket_reads insert+delete, ticket_labels
    // insert+delete. If this drops to zero the guard has gone blind — most
    // likely because the statements moved to another file or to the query
    // builder, in which case add that file to `files` above.
    expect(touching.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of files) {
    it(`${file}: every raw statement touching a parentless table filters workspace_id`, () => {
      const offenders: string[] = [];

      for (const stmt of rawSqlStatements(read(file))) {
        const touches = parentlessTablesIn(stmt);
        if (touches.length === 0) continue;
        // The parent filter must be part of THIS statement, not a check done
        // beforehand that a concurrent request could invalidate.
        if (!/workspace_id\s*=/.test(stmt)) {
          offenders.push(
            `[${touches.join(", ")}] in: ${stmt.trim().slice(0, 120)}…`,
          );
        }
      }

      expect(offenders).toEqual([]);
    });
  }

  it("the star/read/label writes really are INSERT…SELECT-guarded, not check-then-write", () => {
    // A bare `INSERT INTO ticket_stars (…) VALUES (…)` would mean the workspace
    // check happened somewhere else and can go stale. Every insert into a
    // parentless table must select its rows out of the parent instead.
    for (const file of ["lib/data.ts", "lib/labels.ts"]) {
      for (const stmt of rawSqlStatements(read(file))) {
        const insert = stmt.match(
          /INSERT\s+INTO\s+(ticket_labels|ticket_stars|ticket_reads)\b/i,
        );
        if (!insert) continue;
        expect(stmt, `${file}: ${insert[1]} insert must be INSERT…SELECT`).toMatch(
          /INSERT\s+INTO[\s\S]*?SELECT[\s\S]*?FROM[\s\S]*?workspace_id\s*=/i,
        );
      }
    }
  });

  it("deletes from parentless tables join up to the parent (USING)", () => {
    for (const file of ["lib/data.ts", "lib/labels.ts"]) {
      for (const stmt of rawSqlStatements(read(file))) {
        const del = stmt.match(
          /DELETE\s+FROM\s+(ticket_labels|ticket_stars|ticket_reads)\b/i,
        );
        if (!del) continue;
        expect(stmt, `${file}: ${del[1]} delete must join the parent`).toMatch(
          /USING[\s\S]*?workspace_id\s*=/i,
        );
      }
    }
  });
});

describe("the ticket_messages export path filters through its ticket", () => {
  it("selects ticket_messages only via an innerJoin on tickets", () => {
    const src = read("lib/data.ts");
    // exportWorkspaceData is the one place a whole workspace's messages leave
    // the system. ticket_messages has no workspace_id, so the join IS the
    // tenant filter — if this select ever loses it, every tenant's mail is in
    // the export.
    expect(src).toMatch(
      /\.from\(ticketMessages\)[\s\S]{0,200}?\.innerJoin\(\s*tickets[\s\S]{0,200}?eq\(\s*tickets\.workspaceId/,
    );
  });
});

/**
 * Drizzle renders a column interpolated into a raw sql`` fragment WITHOUT a
 * table qualifier when the surrounding select has a single table. lib/labels.ts
 * depends on knowing this: its per-label ticket count writes `labels.id`
 * literally rather than interpolating the column, because the subquery joins
 * `tickets` and an unqualified "id" would bind to the wrong table and silently
 * count zero.
 *
 * These assertions pin that behaviour so a Drizzle upgrade that changes
 * qualification can't quietly reintroduce the bug.
 */
describe("Drizzle column qualification inside raw subqueries", () => {
  const qb = new QueryBuilder();

  /**
   * The qualification depends on CONTEXT, which is what makes this a trap: a
   * fragment rendered on its own comes out qualified, but the same fragment in
   * the field list of a single-table select comes out bare. Only the second is
   * how these subqueries are actually written, so that is what we reproduce.
   */
  it("interpolating a column into a single-table select renders it UNQUALIFIED", () => {
    const { sql: rendered } = qb
      .select({
        id: labels.id,
        count: sql<number>`(
          SELECT count(*) FROM ticket_labels tl
          JOIN tickets t ON t.id = tl.ticket_id
          WHERE tl.label_id = ${labels.id}
        )`,
      })
      .from(labels)
      .toSQL();

    // The hazard: a bare "id" inside a subquery that has joined `tickets`.
    expect(rendered).toMatch(/tl\.label_id = "id"/);
    expect(rendered).not.toMatch(/tl\.label_id = "labels"\."id"/);
  });

  it("lib/labels.ts therefore writes labels.id literally in the count subquery", () => {
    const src = read("lib/labels.ts");
    // The correlated count must name the outer table itself.
    expect(src).toMatch(/WHERE\s+tl\.label_id\s*=\s*labels\.id/);
    // …and must not have regressed to the interpolated form.
    expect(src).not.toMatch(/tl\.label_id\s*=\s*\$\{labels\.id\}/);
  });

  /**
   * KNOWN FRAGILITY, deliberately recorded rather than asserted as broken.
   *
   * listContactsWithCounts in lib/data.ts uses the interpolated form
   * (`t.customer_email = ${contacts.email}`), which renders as bare "email".
   * It is correct TODAY only by luck: the subquery's own table (tickets) has
   * no `email` column, so Postgres resolves the name outward to contacts.email.
   *
   * Add an `email` column to `tickets` and this silently starts comparing
   * tickets.customer_email to tickets.email, and every contact's ticket count
   * quietly becomes wrong. This test fails the moment that column appears,
   * which is exactly when someone needs to know.
   */
  it("listContactsWithCounts' correlated subquery has no shadowing column on tickets", () => {
    const contactsQ = qb.select({ id: contacts.id, c: sql<number>`(SELECT count(*) FROM tickets t WHERE t.customer_email = ${contacts.email})` }).from(contacts).toSQL().sql;
    expect(contactsQ).toMatch(/t.customer_email = "email"/);

    const schema = read("db/schema.ts");
    const ticketsBlock = schema.slice(
      schema.indexOf("export const tickets = pgTable("),
      schema.indexOf("export const ticketMessages = pgTable("),
    );
    expect(ticketsBlock.length).toBeGreaterThan(0);
    // If this ever fails, qualify the subquery in listContactsWithCounts
    // (write `contacts.email` literally, as lib/labels.ts does).
    expect(ticketsBlock).not.toMatch(/\bemail:\s*text\("email"\)/);
  });
});
