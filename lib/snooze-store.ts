import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";

/**
 * Archive and snooze: the IO half. The rules live in lib/snooze.ts.
 *
 * ── TENANCY ──
 * Every statement carries the workspace predicate INSIDE the mutating
 * statement, never a read-then-write. A ticket id arrives from a request, and
 * a check performed beforehand can be invalidated between the check and the
 * write. Same posture as lib/trash-store.ts, and policed by
 * tests/tenancy-invariants.test.ts.
 *
 * ── THERE IS NO UN-SNOOZE FUNCTION IN HERE ──
 * Not an omission. Snoozed is derived from `snoozed_until > now()`, evaluated
 * per query, so a ticket returns to the inbox on its own when its time
 * arrives. `unsnoozeTicket` below is for a person changing their mind EARLY —
 * it is not a scheduler, and nothing calls it on a timer. See db/schema.ts.
 */

/**
 * Take a ticket off the inbox without claiming it is resolved.
 *
 * Idempotent by `archived_at IS NULL`, so archiving twice does not restamp the
 * time. Nothing currently reads that timestamp for ordering, but a second
 * click silently rewriting when something happened is the sort of thing that
 * makes a later "archived 3 days ago" wrong for no visible reason.
 *
 * Returns false when nothing matched: wrong workspace, no such ticket, or it
 * was already archived. The caller cannot tell those apart and should not —
 * distinguishing them for a request-supplied id is an oracle for whether
 * another tenant's ticket exists.
 */
export async function archiveTicket(input: {
  workspaceId: number;
  ticketId: number;
}): Promise<boolean> {
  const res = await db
    .update(tickets)
    .set({ archivedAt: sql`now()` })
    .where(
      and(
        eq(tickets.id, input.ticketId),
        eq(tickets.workspaceId, input.workspaceId),
        isNull(tickets.archivedAt),
        // Archiving something in the trash would put it in two "not here"
        // states at once, and restoring it from the trash would then return it
        // to a folder the person is not looking at. Refuse instead.
        isNull(tickets.deletedAt),
      ),
    )
    .returning({ id: tickets.id });

  return res.length > 0;
}

/** Put an archived ticket back in the inbox. */
export async function unarchiveTicket(input: {
  workspaceId: number;
  ticketId: number;
}): Promise<boolean> {
  const res = await db
    .update(tickets)
    .set({ archivedAt: null })
    .where(
      and(
        eq(tickets.id, input.ticketId),
        eq(tickets.workspaceId, input.workspaceId),
        isNotNull(tickets.archivedAt),
      ),
    )
    .returning({ id: tickets.id });

  return res.length > 0;
}

/**
 * Hide a ticket until a moment in the future.
 *
 * ── THE DEADLINE IS COMPUTED IN POSTGRES ──
 * `until` arrives as a number of minutes and the interval is built in SQL from
 * the same clock the predicate later compares against. Passing an absolute
 * timestamp from JS would set the wake time by a serverless instance's idea of
 * the time and then test it against the database's, and those disagree often
 * enough to matter when the symptom is "it came back an hour early" — which
 * nobody would report as a bug, they would just stop trusting snooze.
 *
 * Re-snoozing an already-snoozed ticket is ALLOWED and replaces the time.
 * Unlike archive, that is what the person means: "actually, next week." So
 * there is no `IS NULL` guard here, deliberately.
 */
export async function snoozeTicket(input: {
  workspaceId: number;
  ticketId: number;
  minutes: number;
  /** Email snapshot of whoever snoozed it. See tickets.snoozedBy. */
  snoozedBy: string;
}): Promise<boolean> {
  // Guard in code as well as at the caller: a non-finite or negative interval
  // would either error in Postgres or set a wake time in the past, and the
  // latter is a ticket that silently never hides at all.
  if (!Number.isFinite(input.minutes) || input.minutes <= 0) return false;
  const minutes = Math.floor(input.minutes);

  const res = await db
    .update(tickets)
    .set({
      snoozedUntil: sql`now() + make_interval(mins => ${minutes})`,
      snoozedBy: input.snoozedBy,
    })
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
 * Wake a snoozed ticket now, because somebody changed their mind.
 *
 * NOT a scheduler. Tickets wake on their own — see the note at the top of this
 * file. This exists for the person who snoozed something until Monday and
 * wants it back today.
 *
 * `snoozedBy` is cleared too: keeping it would leave a woken ticket carrying a
 * stale "snoozed by Emma" that no screen shows and the next reader of the row
 * would have to work out was historical. Same reasoning as clearing
 * `deletedBy` on restore from trash.
 */
export async function unsnoozeTicket(input: {
  workspaceId: number;
  ticketId: number;
}): Promise<boolean> {
  const res = await db
    .update(tickets)
    .set({ snoozedUntil: null, snoozedBy: null })
    .where(
      and(
        eq(tickets.id, input.ticketId),
        eq(tickets.workspaceId, input.workspaceId),
        isNotNull(tickets.snoozedUntil),
      ),
    )
    .returning({ id: tickets.id });

  return res.length > 0;
}
