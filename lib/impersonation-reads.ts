import "server-only";
import { asc, desc, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { impersonationReads } from "@/db/schema";

/**
 * Recording which client records an operator opened.
 *
 * ── WHY THIS IS SEPARATE FROM lib/impersonation.ts ──
 * That module governs ACCESS: who may enter a workspace, when the visit
 * started, when it ended, and the hash chain over all of it. Its write path is
 * fail-closed, because an operator inside a client with no row naming them is
 * the thing it exists to prevent.
 *
 * This one is different in exactly that respect, and mixing them would make
 * the difference easy to lose. See below.
 *
 * ── BEST EFFORT, DELIBERATELY, UNLIKE THE SESSION ROW ──
 * A read that cannot be logged must NOT stop the page rendering.
 *
 * That is not the same trade-off as startImpersonation, and the difference is
 * worth being explicit about. Refusing to open a workspace when the audit
 * write fails costs an operator one retry and guarantees the visit is
 * recorded. Refusing to render a TICKET when the read log write fails would
 * break the product mid-investigation — usually while somebody is helping a
 * client with an urgent problem — and the visit itself is already recorded and
 * chained. So this swallows its errors and the session row remains the
 * guarantee.
 *
 * The honest consequence: this log is a record of reads that were successfully
 * recorded, not a proof that no other read happened. Anything that describes
 * it to a client has to say so — app/(admin)/admin/sections.tsx does.
 */

/**
 * Note that a ticket was opened during an impersonation session.
 *
 * Upserts one row per (session, ticket). Opening the same thread eleven times
 * while working through a problem is one row with a count of eleven, which is
 * both smaller and more readable than eleven rows.
 */
export async function recordImpersonationRead(
  sessionId: number,
  ticketId: number,
): Promise<void> {
  try {
    await db
      .insert(impersonationReads)
      .values({ sessionId, ticketId, count: 1 })
      .onConflictDoUpdate({
        target: [impersonationReads.sessionId, impersonationReads.ticketId],
        set: {
          count: sql`${impersonationReads.count} + 1`,
          lastAt: sql`now()`,
        },
      });
  } catch (err) {
    // See the header: a page must not fail because its access log did.
    console.error("[impersonation-reads] could not record a read:", err);
  }
}

export type ImpersonationReadRow = {
  ticketId: number;
  count: number;
  firstAt: Date;
  lastAt: Date;
};

/**
 * The records touched during each of these visits, most recent first.
 *
 * ONE query for a whole page of sessions, not one per row. The admin console
 * lists every recorded visit, and a per-row lookup there would be a query per
 * session on the busiest page in the console.
 *
 * Unpaginated on purpose. The result is bounded by the number of DISTINCT
 * tickets an operator opened, which is small by construction — and a session
 * that touched enough rows to need paging is itself the finding, so it should
 * arrive in full rather than behind a "show more".
 *
 * Returns a Map, and sessions with no recorded reads are simply absent from
 * it. A caller must render that as "none recorded", never as "none happened":
 * the write path above is best effort, and a visit that predates this table
 * has nothing to show either.
 */
export async function readsForSessions(
  sessionIds: readonly number[],
): Promise<Map<number, ImpersonationReadRow[]>> {
  const out = new Map<number, ImpersonationReadRow[]>();
  if (sessionIds.length === 0) return out;
  try {
    const rows = await db
      .select({
        sessionId: impersonationReads.sessionId,
        ticketId: impersonationReads.ticketId,
        count: impersonationReads.count,
        firstAt: impersonationReads.firstAt,
        lastAt: impersonationReads.lastAt,
      })
      .from(impersonationReads)
      /*
        inArray, not a hand-built IN list. The first version of this
        interpolated the ids through sql.raw with a Number() coercion in
        front — safe as written, and exactly the shape
        tests/tenancy-invariants.test.ts exists to police, because the
        coercion is one careless edit away from disappearing. The builder
        parameterises it and cannot be got wrong.
      */
      .where(inArray(impersonationReads.sessionId, [...sessionIds]))
      .orderBy(desc(impersonationReads.lastAt), asc(impersonationReads.ticketId));
    for (const r of rows) {
      const list = out.get(r.sessionId);
      const entry = {
        ticketId: r.ticketId,
        count: r.count,
        firstAt: r.firstAt,
        lastAt: r.lastAt,
      };
      if (list) list.push(entry);
      else out.set(r.sessionId, [entry]);
    }
  } catch (err) {
    console.error("[impersonation-reads] could not read the log:", err);
  }
  return out;
}
