import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  impersonationSessions,
  type Admin,
  type ImpersonationEnd,
  type ImpersonationSession,
  type Workspace,
} from "@/db/schema";

/**
 * The impersonation audit trail.
 *
 * Every time an operator enters a client workspace a row is written here, and
 * every exit we can observe closes it. This module is the only writer; nothing
 * exposes a delete, by design (see db/schema.ts).
 *
 * Reads and writes here are deliberately dumb — no caching, no batching. An
 * audit record that might be stale is worse than one extra round trip.
 */

/** Cookie holding the id of the operator's open impersonation session. */
export const ADMIN_IMP_COOKIE = "pb_admin_imp";

/**
 * Every timestamp this table records comes from the database clock, never the
 * app's. Two Vercel regions disagreeing by a few seconds is invisible until
 * someone tries to line this log up against a mail provider's timestamps.
 */
const NOW = sql`now()`;

/**
 * How often the heartbeat is allowed to write. Every dashboard request would
 * be one UPDATE per navigation for no extra fidelity; a minute is fine enough
 * to bound an abandoned session and cheap enough to run unconditionally.
 */
const HEARTBEAT_DUE = sql`now() - interval '60 seconds'`;

/**
 * After this much silence an open session is presented as abandoned rather
 * than in progress. It does NOT close the row — nothing but an observed exit
 * writes endedAt — it only changes how the log describes it.
 */
export const ABANDONED_AFTER_MS = 15 * 60 * 1000;

/**
 * Open a session. Any session the operator already had open is closed first as
 * "switched", so one operator can never hold two workspaces at once.
 *
 * Callers must treat a throw as fatal and NOT enter the workspace: entering
 * without a record is exactly the state this table exists to eliminate.
 */
export async function startImpersonation({
  admin,
  workspace,
  reason,
}: {
  admin: Admin;
  workspace: Workspace;
  reason?: string | null;
}): Promise<number> {
  await endOpenSessionsForAdmin(admin.id, "switched");

  const [row] = await db
    .insert(impersonationSessions)
    .values({
      adminId: admin.id,
      adminEmail: admin.email,
      adminClerkUserId: admin.clerkUserId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      reason: reason?.trim() || null,
    })
    .returning({ id: impersonationSessions.id });

  return row.id;
}

/** Close one session, if it is still open. Closing twice is a no-op. */
export async function endImpersonation(
  sessionId: number,
  endedReason: ImpersonationEnd,
): Promise<void> {
  await db
    .update(impersonationSessions)
    .set({ endedAt: NOW, endedReason })
    .where(
      and(
        eq(impersonationSessions.id, sessionId),
        isNull(impersonationSessions.endedAt),
      ),
    );
}

/** Close every open session for an operator. */
export async function endOpenSessionsForAdmin(
  adminId: number,
  endedReason: ImpersonationEnd,
): Promise<void> {
  await db
    .update(impersonationSessions)
    .set({ endedAt: NOW, endedReason })
    .where(
      and(
        eq(impersonationSessions.adminId, adminId),
        isNull(impersonationSessions.endedAt),
      ),
    );
}

/**
 * Close every open session pointed at a workspace. Must run BEFORE the
 * workspace is deleted — the FK is "set null", so afterwards there is nothing
 * left to match on.
 */
export async function endOpenSessionsForWorkspace(
  workspaceId: number,
  endedReason: ImpersonationEnd,
): Promise<void> {
  await db
    .update(impersonationSessions)
    .set({ endedAt: NOW, endedReason })
    .where(
      and(
        eq(impersonationSessions.workspaceId, workspaceId),
        isNull(impersonationSessions.endedAt),
      ),
    );
}

/**
 * Heartbeat. One throttled UPDATE — the WHERE does the rate limiting, so there
 * is no read first and concurrent requests can't double-write.
 */
export async function touchImpersonation(sessionId: number): Promise<void> {
  await db
    .update(impersonationSessions)
    .set({ lastSeenAt: NOW })
    .where(
      and(
        eq(impersonationSessions.id, sessionId),
        isNull(impersonationSessions.endedAt),
        lt(impersonationSessions.lastSeenAt, HEARTBEAT_DUE),
      ),
    );
}

/** A session that is still open, by id. Null if it never existed or is closed. */
export async function getOpenSession(
  sessionId: number,
): Promise<ImpersonationSession | null> {
  const rows = await db
    .select()
    .from(impersonationSessions)
    .where(
      and(
        eq(impersonationSessions.id, sessionId),
        isNull(impersonationSessions.endedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The whole log, newest first. */
export async function listImpersonationSessions(
  limit = 200,
): Promise<ImpersonationSession[]> {
  return db
    .select()
    .from(impersonationSessions)
    .orderBy(desc(impersonationSessions.startedAt))
    .limit(limit);
}

/** One workspace's log, newest first — the client-facing question. */
export async function listImpersonationSessionsForWorkspace(
  workspaceId: number,
  limit = 10,
): Promise<ImpersonationSession[]> {
  return db
    .select()
    .from(impersonationSessions)
    .where(eq(impersonationSessions.workspaceId, workspaceId))
    .orderBy(desc(impersonationSessions.startedAt))
    .limit(limit);
}

/**
 * How a row should be described. "abandoned" is the honest name for an open
 * session that stopped talking to us: we know when it started and when we last
 * saw it, and nothing more.
 */
export type SessionState = "active" | "abandoned" | "ended";

export function sessionState(
  session: ImpersonationSession,
  now: number = Date.now(),
): SessionState {
  if (session.endedAt) return "ended";
  return now - new Date(session.lastSeenAt).getTime() > ABANDONED_AFTER_MS
    ? "abandoned"
    : "active";
}

/**
 * Classify a whole list against one instant, so a long log can't come out with
 * a row on either side of the abandoned threshold. Lives here rather than in
 * the component because reading the clock is not something a render may do.
 */
export function sessionStates(
  sessions: ImpersonationSession[],
): SessionState[] {
  const now = Date.now();
  return sessions.map((s) => sessionState(s, now));
}
