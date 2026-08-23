/**
 * Archive and snooze: the rules. Pure, so they can be tested without a
 * database. The IO lives in lib/snooze-store.ts.
 */

/**
 * The snooze durations offered in the UI.
 *
 * Minutes, not absolute times, and the interval is added by Postgres at write
 * time — see snoozeTicket(). "Tomorrow morning" is deliberately absent from
 * this list even though every mail client offers it: it means 9am in the
 * VIEWER's timezone, the server does not know that timezone, and a "tomorrow
 * morning" that fires at 2am for somebody in another country is worse than not
 * offering it. It needs the browser to send an offset, which is a UI change,
 * not a constant.
 */
export const SNOOZE_OPTIONS: { label: string; minutes: number }[] = [
  { label: "3 hours", minutes: 180 },
  { label: "Tomorrow", minutes: 60 * 24 },
  { label: "3 days", minutes: 60 * 24 * 3 },
  { label: "Next week", minutes: 60 * 24 * 7 },
];

/** The longest snooze the API will accept: a year. */
export const MAX_SNOOZE_MINUTES = 60 * 24 * 365;

/**
 * Is this a snooze duration we will act on?
 *
 * Not restricted to SNOOZE_OPTIONS: the values arrive in a form post and the
 * list is presentational, so pinning the API to it would break the moment
 * somebody adds a choice. The cap exists because a snooze of ten years is
 * indistinguishable from deleting the ticket, without the 30-day safety net or
 * the audit trail that deleting it would carry.
 */
export function isValidSnoozeMinutes(minutes: number): boolean {
  return (
    Number.isFinite(minutes) &&
    Number.isInteger(minutes) &&
    minutes > 0 &&
    minutes <= MAX_SNOOZE_MINUTES
  );
}

/**
 * Is this ticket hidden right now?
 *
 * The same question the SQL predicate asks, in JS, for code holding a row it
 * has already read. Kept in step with `isSnoozed` in app/(dashboard)/queries.ts
 * — a test pins the two agreeing on the boundary.
 */
export function isSnoozedNow(
  snoozedUntil: Date | null,
  now: Date = new Date(),
): boolean {
  if (snoozedUntil === null) return false;
  return snoozedUntil.getTime() > now.getTime();
}

/**
 * How long until it comes back, in words a person would use.
 *
 * Rounds UP for anything under an hour, so a ticket 40 minutes from waking
 * reads "in 1 hour" rather than "in 0 hours". Saying zero of something that
 * has not happened yet reads as a bug.
 */
export function describeWakeIn(
  snoozedUntil: Date | null,
  now: Date = new Date(),
): string | null {
  if (!isSnoozedNow(snoozedUntil, now)) return null;
  const ms = (snoozedUntil as Date).getTime() - now.getTime();
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/*
 * formatWakeTime lived here and was deleted on the day it was written.
 *
 * It rendered the absolute wake time ("Hidden until tomorrow, 9:41 AM"), and
 * that cannot be done on the server: toLocaleTimeString would use the SERVER's
 * timezone and show UTC to everybody, which is the same bug lib/serialize.ts
 * calls out for message timestamps. The thread formats it in the browser
 * instead, from the raw ISO string.
 *
 * describeWakeIn stays because a relative duration carries no timezone, so it
 * is safe to compute server-side — and computing it there is what lets the
 * server, not the client, decide whether the banner exists at all.
 */
