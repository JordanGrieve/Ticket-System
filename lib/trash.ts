/**
 * Trash: the rules half. Pure — no database, no clock of its own.
 *
 * ── THE POLICY ──
 * Deleting a ticket hides it for 30 days, then destroys it. That is what every
 * mail client a client already uses means by "delete", and it is the only
 * arrangement where a stray click does not permanently lose a customer's
 * enquiry.
 *
 * The 30 days are not a grace period bolted onto a delete — they are the
 * delete. Nothing else in the product removes a ticket, so this sweep is the
 * only path by which customer correspondence leaves the database, which is
 * exactly why it is bounded, logged, and refuses to run on anything it cannot
 * prove is due.
 */

/**
 * How long a deleted ticket is recoverable.
 *
 * 30 days because that is what Gmail, Outlook and Apple Mail all do, and a
 * client's intuition about "deleted" is built entirely from those. A shorter
 * window would surprise somebody who came back after a fortnight's holiday;
 * a longer one keeps customer data alive past the point anybody asked for.
 */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a ticket deleted at `deletedAt` becomes eligible for purging. */
export function purgeDueAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS);
}

/** Whole days left before permanent deletion. Never negative. */
export function daysUntilPurge(deletedAt: Date, now: Date): number {
  const ms = purgeDueAt(deletedAt).getTime() - now.getTime();
  if (ms <= 0) return 0;
  // Ceil, not floor: with eight hours to go somebody has "1 day", not "0".
  // Telling them 0 while the ticket is still restorable reads as a bug.
  return Math.ceil(ms / DAY_MS);
}

export function isPurgeDue(deletedAt: Date, now: Date): boolean {
  return purgeDueAt(deletedAt).getTime() <= now.getTime();
}

/**
 * What the trash screen tells somebody about one ticket.
 *
 * Always names the deadline. A trash folder that does not say when things go
 * is one people are afraid to use and equally afraid to empty.
 */
export function describeRetention(deletedAt: Date, now: Date): string {
  const days = daysUntilPurge(deletedAt, now);
  if (days === 0) return "Will be deleted permanently within the hour.";
  if (days === 1) return "Will be deleted permanently tomorrow.";
  return `Will be deleted permanently in ${days} days.`;
}

/**
 * Who deleted it, for display.
 *
 * `deletedBy` is an email snapshot taken at deletion, so it is present even
 * after that teammate is removed — see the column comment in db/schema.ts.
 * Null only for rows deleted before the column existed, which is no rows in
 * practice but is a state the type allows and the UI must not render as
 * "undefined".
 */
export function describeDeletedBy(deletedBy: string | null): string {
  return deletedBy?.trim() || "someone on your team";
}
