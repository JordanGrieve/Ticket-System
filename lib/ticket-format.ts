/**
 * Presentation helpers that are safe to run in the browser.
 *
 * This module exists because of a production outage (Sentry POSTBOX-6). It has
 * exactly one rule, and the rule is the whole point of the file:
 *
 *   NOTHING IN HERE MAY IMPORT `lib/config` — OR ANYTHING THAT DOES.
 *
 * `components/mail/MailNavShell.tsx` is a client component and needs
 * `initials()`. It used to get it from `lib/tickets`, which imports
 * `lib/config` for `INBOUND_DOMAIN`. That one import dragged the entire config
 * module into the client bundle, where it was evaluated in the browser with
 * `process.env.INBOUND_EMAIL_DOMAIN` inlined as `undefined` — because only
 * NEXT_PUBLIC_* vars exist there. Back when config threw on a missing var, that
 * meant every authed page 500'd.
 *
 * Removing the throw stopped the bleeding but not the leak: the config module
 * still shipped to browsers, so anything later added to it — a secret, an
 * internal hostname — would have shipped too, silently, in a public JS chunk.
 *
 * The split is the durable fix. `lib/config` now carries `server-only`, so this
 * boundary is enforced by the compiler rather than by remembering: importing
 * `lib/tickets` (or anything else config-dependent) from a client component is
 * now a build error, not a bundle surprise. Client components import from here.
 *
 * `lib/tickets` re-exports everything below, so server code can keep using the
 * single `@/lib/tickets` import it already has.
 */

/** Human-friendly ticket reference, e.g. TKT-4821. */
export function formatTicketRef(id: number): string {
  return `TKT-${id}`;
}

/** Two-letter initials from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Compact relative time like "12m", "3h", "2d", "5w". */
export function relativeTime(from: Date | string, now: Date = new Date()): string {
  const then = typeof from === "string" ? new Date(from) : from;
  const secs = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

/** A tidy first-line preview for the inbox list. */
export function previewText(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}
