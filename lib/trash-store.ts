import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { TRASH_RETENTION_DAYS } from "./trash";

/**
 * Trash: the IO half. The rules live in lib/trash.ts.
 *
 * ── TENANCY ──
 * Every statement here carries the workspace predicate INSIDE the mutating
 * statement, never a read-then-write. A ticket id arrives from a request; a
 * check performed beforehand can be invalidated between the check and the
 * write, and on a delete that means deleting somebody else's mail.
 *
 * The purge is the exception and says why at its own comment: it is a
 * platform-wide sweep with no caller-supplied workspace.
 */

/**
 * Move a ticket to the trash.
 *
 * Idempotent by `deleted_at IS NULL`: deleting an already-deleted ticket is a
 * no-op rather than resetting its 30-day clock. Without that, a double-click —
 * or a second tab — would silently buy the ticket another month, which is the
 * opposite of what the person pressing delete intends.
 *
 * Returns false when nothing matched: wrong workspace, no such ticket, or it
 * was already in the trash. The caller cannot tell those apart, and should not
 * — distinguishing them for an id supplied by a request is an oracle for
 * whether another tenant's ticket exists.
 */
export async function moveTicketToTrash(input: {
  workspaceId: number;
  ticketId: number;
  /** Email snapshot of whoever pressed delete. See tickets.deletedBy. */
  deletedBy: string;
}): Promise<boolean> {
  const res = await db
    .update(tickets)
    .set({ deletedAt: sql`now()`, deletedBy: input.deletedBy })
    .where(
      and(
        eq(tickets.id, input.ticketId),
        eq(tickets.workspaceId, input.workspaceId),
        isNull(tickets.deletedAt),
      ),
    )
    .returning({ id: tickets.id });

  return res.length > 0;
}

/**
 * Take a ticket back out of the trash.
 *
 * `deletedBy` is cleared too. Keeping it would leave a restored ticket
 * carrying a stale "deleted by Emma" that no screen shows and the next reader
 * of the row would have to work out was historical.
 */
export async function restoreTicketFromTrash(input: {
  workspaceId: number;
  ticketId: number;
}): Promise<boolean> {
  const res = await db
    .update(tickets)
    .set({ deletedAt: null, deletedBy: null })
    .where(
      and(
        eq(tickets.id, input.ticketId),
        eq(tickets.workspaceId, input.workspaceId),
        isNotNull(tickets.deletedAt),
      ),
    )
    .returning({ id: tickets.id });

  return res.length > 0;
}

/**
 * Permanently destroy tickets whose 30 days are up.
 *
 * ── THIS IS THE ONLY THING IN THE PRODUCT THAT DESTROYS CUSTOMER MAIL ──
 * Nothing else deletes a ticket. So this statement is written to be provably
 * conservative rather than merely correct:
 *
 *  - `deleted_at IS NOT NULL` first. A null is a live ticket, and no arithmetic
 *    on a null should ever be able to select one. Postgres would not, but the
 *    predicate says so anyway because the cost of being wrong here is a
 *    client's correspondence and there is no backup to restore it from.
 *  - The interval is computed IN POSTGRES from the same clock that stamped
 *    `deleted_at`. Passing a cutoff from JS would compare the database's
 *    timestamps against a serverless instance's idea of the time, and those
 *    disagree often enough to matter when the answer is destruction.
 *  - LIMIT via a CTE, so one neglected month cannot turn into an enormous
 *    statement. Nothing here is time-critical; the rest go on the next run.
 *
 * Child rows all cascade — messages, labels, stars, reads, and any files
 * hanging off those messages — so this really does remove everything rather
 * than orphaning it.
 *
 * (Phrased without naming that last table, because tests/unused-tables.test.ts
 * matches the word anywhere in a file and would read a comment as a use. The
 * alternative was exempting this file, which would blind the guard to a real
 * use here later — and file storage is exactly where one will appear.)
 *
 * PLATFORM-WIDE and therefore unscoped by workspace: it runs from the daily
 * health sweep and its whole job is every tenant's expired trash. It reads no
 * addresses and no content — it returns ids and a count.
 */
export async function purgeExpiredTrash(limit = 200): Promise<{
  purged: number;
  workspaceIds: number[];
}> {
  const res = await db.execute(sql`
    WITH due AS (
      SELECT t.id, t.workspace_id
      FROM tickets t
      WHERE t.deleted_at IS NOT NULL
        AND t.deleted_at <= now() - (${TRASH_RETENTION_DAYS} * interval '1 day')
      ORDER BY t.deleted_at
      LIMIT ${limit}
    )
    DELETE FROM tickets
    WHERE id IN (SELECT id FROM due)
    RETURNING id, workspace_id
  `);

  const rows = res.rows as Array<{ workspace_id: number }>;
  return {
    purged: rows.length,
    workspaceIds: [...new Set(rows.map((r) => Number(r.workspace_id)))],
  };
}

/**
 * How many tickets are in a workspace's trash, and the oldest deletion.
 *
 * Used by the trash screen's header so it can say what is about to happen
 * without loading every row.
 */
export async function trashSummary(workspaceId: number): Promise<{
  count: number;
  oldestDeletedAt: Date | null;
}> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${tickets.deletedAt})`,
    })
    .from(tickets)
    .where(
      and(eq(tickets.workspaceId, workspaceId), isNotNull(tickets.deletedAt)),
    );

  return {
    count: row?.count ?? 0,
    oldestDeletedAt: row?.oldest ? new Date(row.oldest) : null,
  };
}
