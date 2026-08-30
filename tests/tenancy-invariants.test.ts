import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
function readTemplate(
  src: string,
  open: number,
): { body: string; end: number } {
  let body = "";
  let i = open + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      body += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") return { body, end: i };
    if (ch === "$" && src[i + 1] === "{") {
      // Walk the interpolation to its matching brace, descending into any
      // template literal it contains, and keep it in the body verbatim.
      let depth = 1;
      let inner = "";
      let k = i + 2;
      while (k < src.length && depth > 0) {
        const c = src[k];
        if (c === "`") {
          const nested = readTemplate(src, k);
          inner += "`" + nested.body + "`";
          k = nested.end + 1;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) break;
        }
        inner += c;
        k++;
      }
      body += "${" + inner + "}";
      i = k + 1;
      continue;
    }
    body += ch;
    i++;
  }
  return { body, end: src.length };
}

function rawSqlStatements(source: string): string[] {
  const out: string[] = [];
  // Two things this has to survive, both of which a `/sql`(.*?)`/` pattern
  // does not, and both of which were hiding real statements from this guard:
  //
  //  1. TYPED fragments. sql<number>`count(*)::int` is everywhere in this
  //     codebase, and a `sql`` `-only pattern walks straight past every one —
  //     including the ticket_labels count subquery in lib/labels.ts and every
  //     ticket_messages subquery in app/(dashboard)/queries.ts.
  //  2. NESTED templates. A lazy match to the next backtick stops at the inner
  //     one in `${sql.join(values, sql`, `)}`, so materialiseAudience's INSERT
  //     into campaign_recipients — the statement that decides which tenant a
  //     recipient row lands in — was being read as its first three lines, with
  //     its workspace predicates chopped off and never checked.
  //
  // So the tag is found by regex and the body is read by a scanner that
  // balances `${…}` and descends into nested templates.
  const tag = /\bsql(?:<[^`]*?>)?`/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    const { body, end } = readTemplate(source, open);
    out.push(body);
    // Skip past the whole statement so nested fragments are not also reported
    // on their own — the outer statement already contains them.
    tag.lastIndex = end + 1;
  }
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

  /**
   * The detector must see TYPED fragments too. This assertion exists because
   * it once did not: `sql<number>`(SELECT … FROM ticket_labels …)`` was
   * invisible, so the count subqueries in lib/labels.ts, lib/search.ts and
   * app/(dashboard)/queries.ts were never policed by anything.
   */
  it("the detector sees sql<T>`…` fragments, not just sql`…`", () => {
    const source = `
      const a = sql\`SELECT 1 FROM ticket_stars\`;
      const b = sql<number>\`SELECT count(*) FROM ticket_labels\`;
      const c = sql<string | null>\`SELECT body FROM ticket_reads\`;
    `;
    const found = rawSqlStatements(source);
    expect(found).toHaveLength(3);
    expect(found.some((s) => s.includes("ticket_labels"))).toBe(true);
    expect(found.some((s) => s.includes("ticket_reads"))).toBe(true);
  });

  /**
   * …and it must read a statement to its END. A lazy match to the next
   * backtick stops inside `${sql.join(rows, sql`, `)}`, which truncated
   * materialiseAudience's INSERT into campaign_recipients to its first three
   * lines — dropping every workspace predicate before the check ran.
   */
  it("the detector reads past a nested sql`…` interpolation", () => {
    const source =
      "const q = sql`INSERT INTO campaign_recipients (email)\n" +
      "  SELECT v.email FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(email)\n" +
      "  JOIN campaigns c ON c.id = ${id} AND c.workspace_id = ${ws}`;";
    const [stmt, ...rest] = rawSqlStatements(source);
    expect(rest).toEqual([]); // the inner fragment is not a statement of its own
    expect(stmt).toContain("JOIN campaigns c");
    expect(/workspace_id\s*=/.test(stmt)).toBe(true);
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
   * THE HAZARD THIS RECORDS HAS SINCE BEEN FIXED, and the test is kept because
   * the hazard has not gone away — only this one instance of it has.
   *
   * listContactsWithCounts in lib/data.ts once used the interpolated form
   * (`t.customer_email = ${contacts.email}`), which renders as a bare "email".
   * That was correct only by luck: the subquery's own table (tickets) has no
   * `email` column, so Postgres resolved the name outward to contacts.email.
   * Add an `email` column to `tickets` and it would silently have compared
   * tickets.customer_email to tickets.email, and every contact's ticket count
   * would quietly have become wrong.
   *
   * It now writes `sql.raw('"contacts"."email"')`, as lib/search.ts does
   * throughout — asserted below. The rendering assertion and the schema check
   * stay: they are what would fail if anyone reintroduced the interpolated
   * form, and the shadowing column is still the thing that would make it bite.
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
    // The fix that took this out of "correct by luck": the column is spelled
    // out, so it no longer depends on which table Postgres resolves it against.
    expect(read("lib/data.ts")).toMatch(
      /t\.customer_email = \$\{sql\.raw\('"contacts"\."email"'\)\}/,
    );
    expect(read("lib/data.ts")).not.toMatch(
      /t\.customer_email = \$\{contacts\.email\}/,
    );

    // If this ever fails, qualify the subquery in listContactsWithCounts
    // (write `contacts.email` literally, as lib/labels.ts does).
    expect(ticketsBlock).not.toMatch(/\bemail:\s*text\("email"\)/);
  });
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * PLATFORM-WIDE RAW SQL INVENTORY
 *
 * The section above polices two files and the six parentless-table statements
 * they contain. That was the whole of the raw SQL in this codebase once. It is
 * not any more: campaign sending, the suppression list, double opt-in, search
 * and the mail folder counts are all hand-written SQL now, and every one of
 * them reads or writes tenant-owned rows.
 *
 * So the guard below is not per-file. It walks lib/ and app/, finds EVERY raw
 * statement that names a tenant-owned table, and requires each one to carry
 * its own workspace predicate â€” or to appear, by name and with a reason, in
 * the exemption list. The exemptions are the point: a statement with no
 * workspace filter is either a decision someone made and wrote down, or a bug.
 * There is no third category, and "nobody looked" stops being expressible.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/** Every table whose rows belong to exactly one client. */
const TENANT_TABLES = [
  "tickets",
  "ticket_messages",
  "contacts",
  "contact_notes",
  "agents",
  "labels",
  "ticket_labels",
  "ticket_stars",
  "ticket_reads",
  "attachments",
  "forms",
  "auto_replies",
  // Added 23 Aug 2026 by the classification test below, which found it
  // unlisted. It carries its own workspace_id and has done since the
  // out-of-hours deferral work landed that morning — so every statement
  // touching it had gone unpoliced by this sweep for the whole day.
  "auto_reply_queue",
  "subscribers",
  "lists",
  "list_subscribers",
  "suppressions",
  "campaigns",
  "campaign_recipients",
  "sending_domains",
];

/**
 * Tables that own no tenant data, so a workspace predicate would be wrong
 * rather than merely absent. Statements touching ONLY these are skipped.
 *
 *  â€¢ rate_limits â€” keyed by an opaque bucket string built in lib/rate-limit.ts.
 *    The bucket IS the whole identity; there is no workspace column to filter
 *    on, and the sweeper deletes by age across all buckets on purpose.
 *  â€¢ ingestion_failures â€” records attempts that FAILED to resolve to a
 *    workspace. Its workspace_id is nullable and frequently null by definition
 *    ("we do not know whose key this was"), which is the fact the admin console
 *    exists to show. Filtering by workspace would hide exactly the rows that
 *    matter. Read only by app/(admin), never by a tenant-facing page.
 *  â€¢ workspaces / admins / impersonation_sessions â€” platform-level tables. The
 *    first IS the tenant; the other two are operator records, policed by
 *    tests/impersonation-invariants.test.ts instead.
 */
const NON_TENANT_TABLES = [
  "rate_limits",
  "ingestion_failures",
  /*
   * feedback_drops holds the bounces and complaints for which NO workspace
   * could be determined — that is the definition of a row in it. It is the one
   * table here whose exemption is not merely "these rows happen to be global"
   * but "attributing these rows is the specific mistake being avoided": a
   * guessed attribution is how one tenant's bounce ends up suppressing another
   * tenant's subscriber.
   */
  "feedback_drops",
  /*
   * admin_actions records what an OPERATOR did to the platform. A row about
   * deleting a workspace is not owned by that workspace — if it were, the
   * cascade would delete the record of its own deletion. It deliberately has
   * no foreign key and no workspace_id at all; `target_id` is a plain integer
   * and `target_label` is a snapshot. See db/schema.ts.
   */
  "admin_actions",
  "workspaces",
  "admins",
  "impersonation_sessions",
];

/**
 * Which tables a raw statement actually reads or writes.
 *
 * Only names in table position count â€” after FROM / JOIN / INTO / UPDATE /
 * USING. A fragment that merely interpolates a Drizzle column
 * (`${tickets.status} != 'closed'`) is not a statement against `tickets`; the
 * surrounding query builder owns its WHERE and will not let it lose the table.
 * Interpolations are stripped first, so a `sql.raw('"tickets"."id"')` sitting
 * inside a `${â€¦}` is not mistaken for a FROM clause.
 */
function tablesReadOrWritten(stmt: string): string[] {
  const bare = stmt.replace(/\$\{[\s\S]*?\}/g, " ? ");
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|USING)\s+"?([a-z_][a-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare)) !== null) found.add(m[1].toLowerCase());
  return [...found];
}

type Exemption = {
  /** Source file the statement lives in. */
  file: string;
  /** Something only this statement says. */
  match: RegExp;
  /** Why the absence of a workspace predicate is correct here. */
  why: string;
};

/**
 * Statements that touch tenant data with NO workspace predicate, deliberately.
 *
 * Every entry has to earn its place, and a test below fails if one of these
 * stops matching anything â€” so deleting the code deletes the excuse, and a
 * stale exemption cannot become cover for a different statement that moved in.
 */
const EXEMPT: Exemption[] = [
  {
    file: "lib/campaign-send.ts",
    match: /SET status = 'sending'/,
    why:
      "promoteDueScheduledCampaigns: the scheduler sweep. A scheduler that " +
      "could only see one tenant would not be a scheduler. It reads no " +
      "addresses and no content â€” it moves a status column and returns ids, " +
      "and every statement downstream is scoped by the workspace_id it " +
      "returns. Documented at the function itself.",
  },
  {
    file: "lib/campaign-send.ts",
    match:
      /SELECT 1 FROM campaign_recipients cr\s+WHERE cr\.campaign_id = \$\{campaigns\.id\}/,
    why:
      "An EXISTS fragment correlated to campaigns.id, composed into a Drizzle " +
      "query. In scheduleCampaign the surrounding .where() carries " +
      "eq(campaigns.workspaceId, â€¦); in claimDueCampaigns the sweep is " +
      "platform-wide for the reason above. The fragment itself cannot leak: " +
      "it yields a boolean, never rows.",
  },
  {
    file: "lib/campaign-send.ts",
    match: /SELECT count\(\*\)::int FROM campaign_recipients cr/,
    why:
      "The stuck-campaign health report for the operator console. " +
      "Platform-wide by design â€” spotting one tenant's stalled send is the " +
      "whole job â€” and it returns a queued COUNT per campaign, no addresses " +
      "and no content.",
  },
  {
    file: "lib/trash-store.ts",
    match: /DELETE FROM tickets/,
    why:
      "purgeExpiredTrash: the 30-day retention sweep, platform-wide because " +
      "expired trash belongs to every tenant and there is no caller-supplied " +
      "workspace. It is the ONLY statement in the product that destroys " +
      "customer correspondence, so it is scoped by TIME instead, and " +
      "conservatively: `deleted_at IS NOT NULL` first so no arithmetic can " +
      "reach a live ticket, the interval computed in Postgres from the same " +
      "clock that stamped the column rather than from a serverless " +
      "instance's, and a bounded CTE so one neglected month cannot become an " +
      "enormous DELETE. It reads no addresses and no content — it returns ids.",
  },
  {
    file: "lib/auto-reply-send.ts",
    match: /UPDATE auto_reply_queue SET\s+status = 'sending'/,
    why:
      "claimDueAutoReplies: the deferred auto-reply sweep, and platform-wide " +
      "for the same reason as the campaign scheduler above â€” it drains held " +
      "acknowledgements for every workspace and there is no caller-supplied " +
      "workspace to filter by. It reads no addresses and no content: it " +
      "latches a status column and RETURNS workspace_id, so the tenancy " +
      "travels with each claimed row rather than being assumed by whatever " +
      "sends it. Every guard is then re-derived from that workspace at send " +
      "time, which is what stops a held reply becoming a mail loop.",
  },
  {
    file: "lib/suppressions.ts",
    match: /UPDATE campaign_recipients\s+SET error =/,
    why:
      "noteProviderFeedback: keyed by provider_message_id, the opaque id SES " +
      "issued for one send, arriving only from the signature-verified SES " +
      "webhook. The key IS the tenancy and there is no caller-supplied " +
      "workspace to filter by. Contrast applyProviderFeedback beside it, " +
      "which writes suppressions and subscribers and therefore derives the " +
      "workspace from the campaign inside the same statement.",
  },
];

/** app/(dashboard)/queries.ts gets a rule rather than a list. See below. */
const CORRELATED_ANCHOR = /\$\{outerTicketId\}/;

/** Walk a directory for TypeScript sources, repo-relative and slash-separated. */
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

type Finding = { file: string; stmt: string; tables: string[] };

/** Every raw statement in lib/ and app/ that reads or writes tenant data. */
function tenantStatements(): Finding[] {
  const out: Finding[] = [];
  for (const file of [...sourcesUnder("lib"), ...sourcesUnder("app")]) {
    for (const stmt of rawSqlStatements(read(file))) {
      const tables = tablesReadOrWritten(stmt).filter((t) =>
        TENANT_TABLES.includes(t),
      );
      if (tables.length === 0) continue;
      out.push({ file, stmt, tables });
    }
  }
  return out;
}

describe("every raw statement touching tenant data is scoped or exempted", () => {
  const findings = tenantStatements();

  it("the sweep is actually finding statements", () => {
    // If this collapses the detector has gone blind â€” most likely because
    // sql`` gained another spelling. Fix rawSqlStatements; do not lower this.
    expect(findings.length).toBeGreaterThanOrEqual(25);
    // â€¦and it must be reaching past the two files the original guard knew.
    const files = new Set(findings.map((f) => f.file));
    expect(files).toContain("lib/campaign-send.ts");
    expect(files).toContain("lib/suppressions.ts");
    expect(files).toContain("lib/subscribe-store.ts");
    expect(files).toContain("lib/search.ts");
    expect(files).toContain("app/(dashboard)/queries.ts");
  });

  it("no statement touches tenant data without a workspace predicate", () => {
    const offenders: string[] = [];

    for (const { file, stmt, tables } of findings) {
      // The predicate must be part of THIS statement, not a check performed
      // beforehand that a concurrent request could invalidate.
      if (/workspace_id\s*=/.test(stmt)) continue;

      // The mail list's correlated subqueries carry no workspace_id of their
      // own: they are anchored to the OUTER ticket row via `outerTicketId`,
      // and the outer query's WHERE is the tenant filter. Both halves of that
      // are asserted in the describe below â€” this branch only recognises the
      // shape, it does not take it on trust.
      if (file === "app/(dashboard)/queries.ts" && CORRELATED_ANCHOR.test(stmt))
        continue;

      if (EXEMPT.some((e) => e.file === file && e.match.test(stmt))) continue;

      offenders.push(
        `${file} [${tables.join(", ")}]: ${stmt
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140)}â€¦`,
      );
    }

    expect(offenders).toEqual([]);
  });

  it("every exemption still matches a real statement, and gives a reason", () => {
    // A stale exemption is worse than none: it reads like a decision made
    // about code that no longer exists, and it silently covers whatever moves
    // into its place.
    for (const e of EXEMPT) {
      const hits = findings.filter(
        (f) => f.file === e.file && e.match.test(f.stmt),
      );
      expect(
        hits.length,
        `stale exemption: ${e.file} ${e.match}`,
      ).toBeGreaterThan(0);
      expect(e.why.length, `exemption needs a reason: ${e.file}`).toBeGreaterThan(60);
    }
  });

  it("the by-table exemptions are still exempt by nature", () => {
    // Guards the list itself. If `rate_limits` ever grows a workspace_id, or
    // `ingestion_failures` makes its one NOT NULL, they stop being exempt and
    // this fails before anyone can lean on the old reasoning.
    const schema = read("db/schema.ts");
    for (const table of ["rate_limits", "ingestion_failures"]) {
      expect(NON_TENANT_TABLES).toContain(table);
      const start = schema.indexOf(`"${table}",`);
      expect(start, `${table} missing from schema`).toBeGreaterThan(0);
      const block = schema.slice(start, start + 2000);
      if (table === "rate_limits") {
        expect(block).not.toMatch(/workspaceId:/);
      } else {
        // Present but NULLABLE. `.notNull()` here would mean every rejected
        // attempt could be attributed to a tenant, which is the opposite of
        // what this table records.
        expect(block).toMatch(/workspaceId: integer\("workspace_id"\)/);
        const col = block.slice(block.indexOf("workspaceId:"));
        expect(col.slice(0, col.indexOf("\n    count:"))).not.toMatch(
          /\.notNull\(\)/,
        );
      }
    }
    /*
     * feedback_drops is exempt because it has no workspace column AT ALL, not
     * because its column is nullable. Adding one would not be a schema tweak —
     * it would be an invitation to fill it in, and a guessed attribution is
     * the exact outcome dropping the bounce exists to prevent.
     */
    const drops = schema.indexOf('"feedback_drops",');
    expect(drops, "feedback_drops missing from schema").toBeGreaterThan(0);
    const dropBlock = schema.slice(drops, schema.indexOf("\n);", drops));
    expect(dropBlock).not.toMatch(/workspaceId:/);
    expect(dropBlock).not.toMatch(/workspace_id/);

    // Nothing may be on both lists.
    for (const t of NON_TENANT_TABLES) expect(TENANT_TABLES).not.toContain(t);
  });
});

/**
 * app/(dashboard)/queries.ts â€” the mail list.
 *
 * Its unread / starred / labelled / preview columns are correlated subqueries
 * over ticket_messages, ticket_reads, ticket_stars and ticket_labels, none of
 * which carry a workspace_id. They are safe for exactly two reasons, and both
 * are load-bearing:
 *
 *   1. every subquery is anchored to the OUTER ticket via `outerTicketId`, and
 *   2. every query they are composed into filters tickets.workspace_id.
 *
 * Lose (1) and the subquery correlates to the inner table and returns another
 * ticket's mail; lose (2) and the outer query spans the platform. Neither is
 * visible in the fragment itself, which is why they are asserted here rather
 * than waved through by the sweep above.
 */
describe("the mail list's correlated subqueries are anchored and outer-scoped", () => {
  const src = read("app/(dashboard)/queries.ts");

  it("the anchor is a literal tickets.id, not an interpolated Drizzle column", () => {
    // `${tickets.id}` would render as a bare "id" and bind to ticket_messages
    // or labels inside the subquery â€” the bug documented at the top of that
    // file. sql.raw of the qualified name is what removes the dependence.
    expect(src).toMatch(/const outerTicketId = sql\.raw\(`"tickets"\."id"`\)/);
  });

  it("every subquery over a parentless table correlates on that anchor", () => {
    for (const stmt of rawSqlStatements(src)) {
      const tables = tablesReadOrWritten(stmt).filter(
        (t) => PARENTLESS.includes(t) || t === "ticket_messages",
      );
      if (tables.length === 0) continue;
      if (/workspace_id\s*=/.test(stmt)) continue; // the label subqueries do both
      expect(stmt, `unanchored subquery over ${tables.join(", ")}`).toMatch(
        CORRELATED_ANCHOR,
      );
    }
  });

  it("folderWhere ANDs the tenant filter into every folder", () => {
    const start = src.indexOf("function folderWhere(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("export type MailCounts"));
    // `mine` is built first and returned first, so no folder branch can drop
    // it — adding a folder cannot accidentally widen the query.
    expect(body).toMatch(/const mine = eq\(tickets\.workspaceId, workspaceId\)/);
    /*
     * `mine` must be the FIRST argument of the returned and(), and outside the
     * spread. Deliberately no longer pinned to the exact argument list: it was
     * `and(mine, ...extra)` until the trash filter joined it, and a test that
     * pins the literal forces the next always-on predicate either to weaken
     * this guard or to be squeezed into `extra`, where a folder branch could
     * drop it. What matters is that the tenant filter is unconditional and out
     * of reach of the branching above.
     */
    expect(body).toMatch(/return and\(\s*mine\s*[,)]/);
    expect(body).not.toMatch(/return and\(\s*\.\.\.extra/);
  });

  it("folderWhere ANDs the trash filter into every folder too", () => {
    // Same shape of invariant, same reason. `bin` is computed unconditionally
    // from the folder and passed outside the spread, so a folder added later
    // hides deleted tickets by doing nothing at all. The alternative — every
    // folder remembering to add `notDeleted` — works until somebody forgets
    // once, and then deleted mail reappears in one folder and nobody can say
    // when it started.
    const start = src.indexOf("function folderWhere(");
    const body = src.slice(start, src.indexOf("export type MailCounts"));
    expect(body).toMatch(
      /const bin = folder === "trash" \? isDeleted : notDeleted/,
    );
    expect(body).toMatch(/return and\(mine, bin[,)]/);
  });

  it("the folder counts exclude deleted tickets in every count but trash", () => {
    // mailCounts does NOT go through folderWhere — it computes every folder in
    // one pass — so it is the one place the trash predicate has to be repeated,
    // and therefore the one place it can be forgotten. A nav badge counting
    // deleted mail sends somebody hunting for a ticket that is not there.
    const start = src.indexOf("export const mailCounts");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, start + 3000);

    for (const folder of [
      "all",
      "inbox",
      "closed",
      "awaiting",
      "unread",
      "starred",
      "labeled",
      "sent",
    ]) {
      const line = body
        .split("\n")
        .find((l) => l.trim().startsWith(folder + ":"));
      expect(line, "no count line found for " + folder).toBeTruthy();
      expect(line, folder + " count does not exclude deleted tickets").toMatch(
        /\$\{notDeleted\}/,
      );
    }

    const trashLine = body
      .split("\n")
      .find((l) => l.trim().startsWith("trash:"));
    expect(trashLine).toMatch(/\$\{isDeleted\}/);
  });

  it("no select in that file reads tickets without a workspace filter", () => {
    // The subqueries inherit their tenancy from these. If one loses its
    // filter, anchoring is no longer protecting anything.
    const froms = [...src.matchAll(/\.from\(tickets\)([\s\S]{0,300})/g)];
    expect(froms.length).toBeGreaterThanOrEqual(4);
    for (const [, after] of froms) {
      expect(after).toMatch(
        /eq\(tickets\.workspaceId, workspaceId\)|folderWhere\(\s*workspaceId/,
      );
    }
  });
});

/**
 * The campaign pipeline writes to campaign_recipients, which is parentless.
 * Same discipline as ticket_stars: the workspace predicate belongs INSIDE the
 * writing statement, joined up to `campaigns`, never in a check above it. A
 * check-then-write here does not merely read the wrong row â€” it sends one
 * client's mail to another client's list.
 */
describe("campaign_recipients writes join up to campaigns in the same statement", () => {
  const src = read("lib/campaign-send.ts");

  it("the recipient INSERT is an INSERTâ€¦SELECT with both parents filtered", () => {
    const insert = rawSqlStatements(src).find((s) =>
      /INSERT\s+INTO\s+campaign_recipients\b/i.test(s),
    );
    expect(insert, "materialiseAudience's INSERT has moved or gone").toBeTruthy();
    expect(insert!).toMatch(
      /INSERT\s+INTO\s+campaign_recipients[\s\S]*?SELECT/i,
    );
    // Subscriber and campaign are both re-asserted against the workspace, so a
    // wrong id above cannot write a row into another tenant's campaign.
    expect(insert!).toMatch(
      /JOIN subscribers s[\s\S]*?s\.workspace_id = \$\{workspaceId\}/,
    );
    expect(insert!).toMatch(
      /JOIN campaigns c[\s\S]*?c\.workspace_id = \$\{workspaceId\}/,
    );
    // Suppression is enforced by the write itself, not by a prior read.
    expect(insert!).toMatch(/LEFT JOIN suppressions sup[\s\S]*?sup\.id IS NULL/);
  });

  it("every write to campaign_recipients names campaigns and filters it", () => {
    const writes = rawSqlStatements(src).filter((s) =>
      /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+campaign_recipients\b/i.test(s),
    );
    // insert, discard-delete, suppression retirement, per-recipient claim.
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const stmt of writes) {
      expect(stmt, "write to campaign_recipients without its parent").toMatch(
        /\bcampaigns\b[\s\S]*?workspace_id\s*=/i,
      );
    }
  });

  it("the per-recipient claim re-checks suppression as it claims", () => {
    // The one statement that marks a row 'sent'. If the NOT EXISTS goes, an
    // address suppressed mid-send still gets mailed.
    const claim = rawSqlStatements(src).find((s) => /SET status = 'sent'/.test(s));
    expect(claim).toBeTruthy();
    expect(claim!).toMatch(
      /NOT EXISTS[\s\S]*?FROM suppressions sup[\s\S]*?sup\.workspace_id = c\.workspace_id/,
    );
    expect(claim!).toMatch(/c\.workspace_id = \$\{input\.workspaceId\}/);
  });
});

/**
 * lib/suppressions.ts and lib/subscribe-store.ts are the two places where a
 * workspace is DERIVED rather than passed in â€” from a campaign row reached by
 * an unsubscribe token or an SES message id. That derivation has to happen in
 * the same statement as the writes that use it, or the workspace the token
 * belongs to and the workspace being written to can drift apart.
 */
describe("derived-workspace statements derive and use it in one statement", () => {
  it("token and message-id lookups derive workspace_id from campaigns", () => {
    const src = read("lib/suppressions.ts");
    const derived = rawSqlStatements(src).filter((s) => /WITH target AS/.test(s));
    expect(derived.length).toBe(2); // unsubscribe-by-token, provider feedback
    for (const stmt of derived) {
      // campaign_recipients has no workspace_id: the JOIN is where tenancy
      // comes from, and it must sit in the same CTE chain that writes.
      expect(stmt).toMatch(
        /FROM campaign_recipients cr[\s\S]*?JOIN campaigns c ON c\.id = cr\.campaign_id/,
      );
      expect(stmt).toMatch(/c\.workspace_id\s+AS workspace_id/);
      // Anything written to subscribers is scoped by the DERIVED workspace,
      // never by the address alone.
      if (/UPDATE subscribers/.test(stmt)) {
        expect(stmt).toMatch(/s\.workspace_id = t\.workspace_id/);
      }
    }
  });

  it("the subscribers/suppressions sync scopes BOTH sides", () => {
    const src = read("lib/suppressions.ts");
    const stmt = rawSqlStatements(src).find((s) =>
      /UPDATE subscribers s[\s\S]*?FROM suppressions sup/.test(s),
    );
    expect(stmt).toBeTruthy();
    // Joining on email alone would let one tenant's block mute another
    // tenant's subscriber who happens to share the address.
    expect(stmt!).toMatch(/s\.workspace_id = \$\{workspaceId\}/);
    expect(stmt!).toMatch(/sup\.workspace_id = \$\{workspaceId\}/);
  });

  it("double opt-in confirms inside one workspace only", () => {
    const src = read("lib/subscribe-store.ts");
    const stmt = rawSqlStatements(src).find((s) => /WITH blocked AS/.test(s));
    expect(stmt).toBeTruthy();
    // Each mutating CTE is workspace-scoped in its own right.
    expect(stmt!).toMatch(
      /FROM suppressions\s+WHERE workspace_id = \$\{input\.workspaceId\}/,
    );
    expect(stmt!).toMatch(
      /UPDATE subscribers s[\s\S]*?WHERE s\.workspace_id = \$\{input\.workspaceId\}/,
    );
    expect(stmt!).toMatch(
      /INSERT INTO lists \(workspace_id[\s\S]*?SELECT\s+\$\{input\.workspaceId\}/,
    );
    // list_subscribers is parentless. It is fed from the two CTEs above, both
    // already scoped â€” never from a fresh lookup, which would read the
    // pre-statement snapshot and could name another tenant's list.
    expect(stmt!).toMatch(
      /INSERT INTO list_subscribers \(list_id, subscriber_id\)\s+SELECT l\.id, s\.id FROM target_list l, subject s/,
    );
  });
});

/**
 * lib/search.ts is the widest read surface in the product: four statements
 * over four tables, driven by a string the user typed. Two of those tables are
 * parentless.
 */
describe("search stays inside one workspace on all four legs", () => {
  const src = read("lib/search.ts");

  it("the message leg's tenancy is the innerJoin, and it is present", () => {
    // ticket_messages has no workspace_id: this join plus the filter beside it
    // is the only thing between a search box and every customer's mail.
    expect(src).toMatch(
      /\.from\(ticketMessages\)\s*\.innerJoin\(tickets, eq\(ticketMessages\.ticketId, tickets\.id\)\)\s*\.where\(\s*and\(\s*eq\(tickets\.workspaceId, workspaceId\)/,
    );
  });

  it("both correlated count subqueries filter workspace_id themselves", () => {
    // The outer WHERE does not constrain a subquery that selects FROM tickets
    // afresh, so each one has to carry its own predicate.
    for (const stmt of rawSqlStatements(src)) {
      const tables = tablesReadOrWritten(stmt).filter((t) =>
        TENANT_TABLES.includes(t),
      );
      if (tables.length === 0) continue;
      expect(stmt, `unscoped search subquery over ${tables.join(", ")}`).toMatch(
        /t\.workspace_id = \$\{workspaceId\}/,
      );
    }
  });

  it("column references inside fragments are spelled out, never interpolated", () => {
    // Same trap as lib/labels.ts: an interpolated column renders bare and
    // binds to the wrong table inside a join. Every one of these is sql.raw.
    for (const name of ["tickets", "ticket_messages", "contacts", "labels"]) {
      expect(src).toMatch(new RegExp(`sql\\.raw\\('"${name}"\\.`));
    }
    expect(src).not.toMatch(/ILIKE[\s\S]{0,40}\$\{(tickets|contacts|labels)\./);
  });
});

describe("the table lists cannot go stale", () => {
  /*
   * TENANT_TABLES and NON_TENANT_TABLES are hand-written, and the whole sweep
   * below only inspects statements that touch a table named in the first list.
   * So a table missing from BOTH lists is not a gap the sweep reports — it is a
   * table the sweep cannot see, and every unscoped statement against it passes
   * silently.
   *
   * That is not hypothetical. `contact_notes` was added earlier today and
   * appeared in neither list; the suite stayed green while a new tenant table
   * went entirely unchecked. It is the same shape as the bug this file was
   * written for, where the guard was green because it could not see.
   *
   * This test makes adding a table to db/schema.ts a decision somebody has to
   * record, rather than something that quietly widens the blind spot.
   */
  it("every table in db/schema.ts is classified as tenant or non-tenant", () => {
    const schema = read("db/schema.ts");

    // pgTable("name", ...) — the first string argument is the SQL table name.
    const declared = [...schema.matchAll(/pgTable\(\s*["'`]([a-z_]+)["'`]/g)].map(
      (m) => m[1],
    );

    expect(declared.length).toBeGreaterThan(10);

    const classified = new Set([...TENANT_TABLES, ...NON_TENANT_TABLES]);
    const unclassified = declared.filter((t) => !classified.has(t));

    expect(
      unclassified,
      `Table(s) in db/schema.ts missing from both TENANT_TABLES and ` +
        `NON_TENANT_TABLES: ${unclassified.join(", ")}. Add each one to ` +
        `TENANT_TABLES if rows belong to a workspace (the sweep will then ` +
        `require every statement touching it to be scoped or exempted), or ` +
        `to NON_TENANT_TABLES if they genuinely do not.`,
    ).toEqual([]);
  });

  it("no table is in both lists", () => {
    const both = TENANT_TABLES.filter((t) => NON_TENANT_TABLES.includes(t));
    expect(both).toEqual([]);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE QUERY BUILDER, WHICH EVERYTHING ABOVE THIS LINE IS BLIND TO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every sweep above reads raw sql`` templates. That is a real guard and it has
 * caught real problems — but raw SQL is the EXCEPTION in this repo, used where
 * a CTE or a data-modifying statement is needed. The default way code here
 * talks to the database is the Drizzle query builder, and none of it is
 * inspected above. So the sweep covers the minority of access paths while
 * reading, to anyone glancing at a green suite, as though it covered them all.
 *
 * Found 23 Aug 2026 while adding app/api/webhooks/resend/route.ts, which
 * updates ticket_messages through the builder. The full suite went green
 * having never looked at the file. The route is in fact correct — but that was
 * established by reading it, which is precisely the work this file exists to
 * stop anyone having to remember to do.
 *
 * ── WHAT THIS SECTION POLICES, AND WHAT IT DOES NOT ──
 * UPDATE and DELETE through the builder, on tables that carry no workspace_id
 * of their own. Those are the leak-shaped operations: the table cannot be
 * filtered by workspace directly, so the predicate has to carry tenancy some
 * other way, and getting that wrong writes across every client at once.
 *
 * INSERT is deliberately not policed. It cannot read another tenant's rows;
 * the risk is attaching a row to the wrong parent, and the parent id is
 * supplied by the caller rather than matched by a predicate — so there is
 * nothing in the statement for a static check to look at. That is a real gap
 * and it is named here rather than left for someone to discover the way this
 * whole section was discovered.
 *
 * Builder READS are not policed either. There are ~90 of them across ~20
 * files, and a guard demanding ninety rubber-stamped exemptions would be
 * approved without being read — which is the false confidence being fixed, not
 * a fix for it.
 */

/**
 * Tables whose tenancy is inherited, DERIVED from db/schema.ts.
 *
 * A table with no `workspaceId` column cannot be filtered by workspace, so
 * every write to it has to carry tenancy some other way. Deriving this instead
 * of hand-listing it is the point: PARENTLESS above is hand-written, and
 * hand-written table lists in this file have gone stale three times
 * (contact_notes, auto_reply_queue, and the four tables the unused-table
 * detector called dead). A table added to the schema tomorrow lands in here on
 * its own.
 */
function inheritsTenancy(): Set<string> {
  const schema = read("db/schema.ts");
  const out = new Set<string>();
  // Each pgTable("name", { … }) block, up to the start of the next export.
  const re =
    /export const (\w+)\s*=\s*pgTable\(\s*["'`]([a-z_]+)["'`]([\s\S]*?)(?=export const |$)/g;
  for (const m of schema.matchAll(re)) {
    if (!/\bworkspaceId\s*:/.test(m[3])) out.add(m[2]);
  }
  /*
   * Platform tables also have no workspaceId, for the opposite reason: they
   * hold no tenant data, so there is nothing to scope. `workspaces` IS the
   * tenant; `admins` and `impersonation_sessions` are operator records,
   * policed by tests/impersonation-invariants.test.ts instead.
   *
   * Without this the guard demanded a written exemption for deleting a
   * workspace by its own id — noise that teaches people the exemption list is
   * something to be silenced rather than read, which is how a list like this
   * stops meaning anything. Deferring to NON_TENANT_TABLES also means one
   * classification serves both sweeps, and that list is already kept honest by
   * "every table in db/schema.ts is classified" above.
   */
  for (const t of NON_TENANT_TABLES) out.delete(t);
  return out;
}

/** Drizzle export name → SQL table name, e.g. ticketMessages → ticket_messages. */
function schemaExportNames(): Map<string, string> {
  const schema = read("db/schema.ts");
  const out = new Map<string, string>();
  for (const m of schema.matchAll(
    /export const (\w+)\s*=\s*pgTable\(\s*["'`]([a-z_]+)["'`]/g,
  )) {
    out.set(m[1], m[2]);
  }
  return out;
}

type BuilderWrite = { file: string; table: string; op: string; stmt: string };

/**
 * Every builder UPDATE/DELETE in lib/ and app/, with the statement text that
 * follows it — which is where the predicate lives.
 */
function builderWrites(): BuilderWrite[] {
  const names = schemaExportNames();
  const out: BuilderWrite[] = [];
  for (const file of [...sourcesUnder("lib"), ...sourcesUnder("app")]) {
    const src = read(file);
    const re = /\.(update|delete)\(\s*(\w+)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const table = names.get(m[2]);
      if (!table) continue;
      // The statement runs to its terminating semicolon; that span contains
      // the .set() and the .where() we need to look at.
      const end = src.indexOf(";", m.index);
      out.push({
        file,
        table,
        op: m[1],
        stmt: src.slice(m.index, end === -1 ? src.length : end),
      });
    }
  }
  return out;
}

/**
 * Builder writes to an inheriting table whose predicate carries tenancy by
 * some route a regex cannot confirm. Each needs a reason a person wrote down.
 */
const BUILDER_EXEMPT: Exemption[] = [
  {
    file: "lib/data.ts",
    match: /\.set\(\{ messageId \}\)/,
    why:
      "backfillOutboundMessageId: updates by ticket_messages.id, and that id " +
      "comes from the select immediately above it, which is constrained to " +
      "one ticketId. The caller is the inbound webhook, which reaches this " +
      "only after matching the ticket's replyToken — ids are guessable, " +
      "tokens are not, so the token is what establishes tenancy and it is " +
      "established before this is called.",
  },
  {
    file: "lib/campaign-send.ts",
    match: /providerMessageId: res\.id \?\? null/,
    why:
      "Stamps the provider's id on the recipient row just sent to. Keyed by " +
      "campaign_recipients.id taken from the claim statement above, which is " +
      "raw SQL, joins up to campaigns and IS policed by the sweep at the top " +
      "of this file. The tenancy travels with the claimed row.",
  },
  {
    file: "lib/campaign-send.ts",
    match: /status: "failed"/,
    why:
      "The same claimed row as the entry above, on the failure branch. Keyed " +
      "by the same campaign_recipients.id from the same policed claim.",
  },
  {
    file: "app/api/webhooks/resend/route.ts",
    match: /eq\(ticketMessages\.providerMessageId, providerId\)/,
    why:
      "Keyed by provider_message_id — the opaque id Resend issued for one " +
      "send, unique platform-wide, arriving only from a signature-verified " +
      "webhook. The key IS the tenancy and there is no caller-supplied " +
      "workspace to filter by. Identical reasoning to noteProviderFeedback in " +
      "lib/suppressions.ts, exempted above for the SES side of the same idea.",
  },
];

describe("builder writes to tables with no workspace_id are scoped or exempted", () => {
  const inheriting = inheritsTenancy();
  const writes = builderWrites();

  it("derives the inheriting tables from the schema, and finds them", () => {
    // If this collapses the derivation has broken — most likely because the
    // schema gained another way of spelling a table. Fix inheritsTenancy();
    // do not lower this.
    expect(inheriting.has("ticket_messages")).toBe(true);
    expect(inheriting.has("ticket_labels")).toBe(true);
    expect(inheriting.has("campaign_recipients")).toBe(true);
    // …and tables that DO carry a workspace_id must not be in it, or the
    // guard would demand exemptions for statements that are plainly scoped.
    expect(inheriting.has("tickets")).toBe(false);
    expect(inheriting.has("contact_notes")).toBe(false);
    expect(inheriting.has("auto_reply_queue")).toBe(false);
  });

  it("the builder sweep is actually finding statements", () => {
    expect(writes.length).toBeGreaterThanOrEqual(15);
    const files = new Set(writes.map((w) => w.file));
    expect(files).toContain("lib/data.ts");
    expect(files).toContain("app/api/webhooks/resend/route.ts");
  });

  it("no builder write to an inheriting table is unaccounted for", () => {
    const offenders: string[] = [];

    for (const w of writes) {
      if (!inheriting.has(w.table)) continue;
      // A predicate naming workspaceId is scoped on its face.
      if (/workspaceId/.test(w.stmt)) continue;
      if (BUILDER_EXEMPT.some((e) => e.file === w.file && e.match.test(w.stmt)))
        continue;

      offenders.push(
        `${w.file} [${w.op} ${w.table}]: ${w.stmt
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140)}…`,
      );
    }

    expect(
      offenders,
      `Builder ${offenders.length === 1 ? "write" : "writes"} to a table with ` +
        `no workspace_id, with no workspace predicate and no recorded reason:` +
        `\n  ${offenders.join("\n  ")}\n\n` +
        `Either constrain the statement by workspace, or add an entry to ` +
        `BUILDER_EXEMPT explaining what carries tenancy instead. Do not add ` +
        `an entry you cannot justify in a sentence — the point of the list is ` +
        `that somebody had to think, not that the suite went green.`,
    ).toEqual([]);
  });

  it("every builder exemption still matches a real statement", () => {
    // A stale exemption is worse than none: it reads as though somebody
    // checked, while protecting nothing.
    for (const e of BUILDER_EXEMPT) {
      const hit = writes.some((w) => w.file === e.file && e.match.test(w.stmt));
      expect(hit, `Stale BUILDER_EXEMPT entry for ${e.file}: ${e.match}`).toBe(
        true,
      );
    }
  });

  it("every builder exemption gives a reason", () => {
    for (const e of BUILDER_EXEMPT) {
      expect(e.why.length, `${e.file} needs a real reason`).toBeGreaterThan(60);
    }
  });
});
