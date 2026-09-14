import type { ImpersonationSession } from "@/db/schema";

/**
 * How an impersonation row should be DESCRIBED. Pure.
 *
 * ── WHY IT IS NOT IN lib/impersonation.ts ──
 *
 * These three were, and that module opens `import { db } from "@/db"`. Nothing
 * noticed while every caller was a server component. The moment one of them —
 * the operator console's account drawer — became part of a client component,
 * importing `sessionState` dragged the database client into the browser bundle
 * and the build stopped, correctly, on `server-only`.
 *
 * Typecheck could not see it: the function's signature is the same either side
 * of that line. Only `next build` walks the import graph, which is why
 * AGENTS.md says to run it after a change that moves code across the
 * server/client boundary.
 *
 * Same split as lib/newsletter.ts against lib/campaign-send.ts, and for the
 * same reason: the rules are pure and the IO is not, so the rules can be used
 * anywhere and tested without a database.
 */

/**
 * "abandoned" is the honest name for an open session that stopped talking to
 * us: we know when it started and when we last saw it, and nothing more.
 */
export type SessionState = "active" | "abandoned" | "ended";

/**
 * After this much silence a session is abandoned: refused for access, and
 * presented in the log as abandoned rather than in progress.
 *
 * It still does NOT close the row. Nothing but an observed exit writes
 * `endedAt`, because that column answers "when did they leave" and a guess
 * there is worse than an honest null.
 */
export const ABANDONED_AFTER_MS = 15 * 60 * 1000;

export function sessionState(
  session: Pick<ImpersonationSession, "endedAt" | "lastSeenAt">,
  now: number = Date.now(),
): SessionState {
  if (session.endedAt) return "ended";
  return now - new Date(session.lastSeenAt).getTime() > ABANDONED_AFTER_MS
    ? "abandoned"
    : "active";
}

/**
 * Classify a whole list against one instant, so a long log cannot come out with
 * a row on either side of the abandoned threshold. Lives here rather than in a
 * component because reading the clock is not something a render may do.
 */
export function sessionStates(
  sessions: Pick<ImpersonationSession, "endedAt" | "lastSeenAt">[],
): SessionState[] {
  const now = Date.now();
  return sessions.map((s) => sessionState(s, now));
}
