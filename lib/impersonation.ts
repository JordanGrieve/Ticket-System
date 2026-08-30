import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  impersonationSessions,
  type Admin,
  type ImpersonationEnd,
  type ImpersonationSession,
  type Workspace,
} from "@/db/schema";
import {
  impersonationGenesisHash,
  impersonationRowHash,
  verifyImpersonationChain,
  type ChainVerification,
  type ImpersonationChainContent,
} from "@/lib/impersonation-chain";

/**
 * The impersonation audit trail.
 *
 * Every time an operator enters a client workspace a row is written here, and
 * every exit we can observe closes it. This module is the only writer; nothing
 * exposes a delete, by design (see db/schema.ts).
 *
 * Reads and writes here are deliberately dumb — no caching, no batching. An
 * audit record that might be stale is worse than one extra round trip.
 *
 * "Nothing exposes a delete" is a statement about this app, not about the
 * table: the app connects as an owner-level role, so a DATABASE_URL holder can
 * still DELETE FROM impersonation_sessions. Every row is therefore hash-chained
 * to the one before it, which does not stop that but does mean it cannot be
 * done quietly — see appendImpersonationRow, verifyImpersonationLog, and the
 * long version in lib/impersonation-chain.ts. Do not describe this log to a
 * client as tamper-proof; "a deletion is detectable" is what is true.
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
 * After this much silence a session is abandoned: refused for access, and
 * presented in the log as abandoned rather than in progress.
 *
 * It still does NOT close the row. Nothing but an observed exit writes
 * `endedAt`, because that column answers "when did they leave" and a guess
 * there is worse than an honest null — see getOpenSession.
 */
export const ABANDONED_AFTER_MS = 15 * 60 * 1000;

/**
 * The same threshold as a SQL expression, derived from the constant rather
 * than written twice. If these two ever disagree, a session shown as abandoned
 * in the access log would still open a client's inbox.
 */
const ABANDONED_CUTOFF = sql.raw(
  `now() - interval '${Math.round(ABANDONED_AFTER_MS / 1000)} seconds'`,
);

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

  return appendImpersonationRow({
    adminId: admin.id,
    adminEmail: admin.email,
    adminClerkUserId: admin.clerkUserId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    reason: reason?.trim() || null,
  });
}

/**
 * The secret that turns the chain from a checksum into something a
 * DATABASE_URL holder cannot forge. Absent is a supported state — the chain
 * still catches accidents — and verification reports which it was, so nothing
 * anywhere claims more than it has. See lib/impersonation-chain.ts.
 *
 * Read at call time rather than at module load so that setting it in the
 * deployment environment takes effect on the next request, not the next
 * rebuild, and read directly rather than through lib/config.ts because that
 * module's defaults-with-a-warning shape is exactly wrong for a secret: a
 * placeholder key would silently produce a chain that verifies against the
 * placeholder.
 */
function chainSecret(): string | null {
  return process.env.IMPERSONATION_CHAIN_SECRET || null;
}

/**
 * How many times an append may lose the race for the head of the chain before
 * giving up. Contention here is close to theoretical — it needs two operators
 * to enter two workspaces within one round trip of each other — and each retry
 * costs two statements, so the bound is small and the failure is loud.
 */
const CHAIN_APPEND_ATTEMPTS = 5;

/** Postgres unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "23505";
}

/**
 * Append one row to the hash chain.
 *
 * ── WHY THE TIMESTAMP IS FETCHED BEFORE THE INSERT ──
 * started_at is part of what the hash covers, so it has to be known before the
 * row is built — which rules out letting the column default to now(). It is
 * still the DATABASE clock (the comment on NOW above is the reason: two Vercel
 * regions disagreeing by seconds is invisible until someone lines this log up
 * against a mail provider's timestamps); it is simply read one statement
 * earlier. That is the "one extra round trip" this module's header already
 * says it prefers over a record that might be wrong.
 *
 * It is truncated to milliseconds because a Postgres timestamptz holds
 * microseconds and a JS Date does not. Store the untruncated value and the
 * row would hash from one instant and read back as a slightly different one,
 * so every row would fail verification for a reason that has nothing to do
 * with tampering.
 *
 * ── WHY THE HASH IS COMPUTED HERE AND NOT IN SQL ──
 * Postgres has a built-in sha256() and this could have been one statement.
 * Rejected for two reasons. First, the verifier is JavaScript, so a SQL writer
 * means two implementations of the same canonical encoding, and the day they
 * disagree about how a non-ASCII character in `reason` is counted, the log
 * reports tampering that never happened. Second, and worse, it would send
 * IMPERSONATION_CHAIN_SECRET to the database on every impersonation — putting
 * the one thing a DATABASE_URL holder is not supposed to have into the query
 * text of the database they hold.
 *
 * ── THE RACE ──
 * Read the head, then insert against it. Two concurrent appends can read the
 * same head; the unique index on chain_prev_hash means only one of them can
 * commit, and the loser comes back here, re-reads, and appends after the
 * winner. See the note on the index in db/schema.ts.
 */
async function appendImpersonationRow(
  content: Omit<ImpersonationChainContent, "startedAt">,
): Promise<number> {
  const secret = chainSecret();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < CHAIN_APPEND_ATTEMPTS; attempt++) {
    // The clock and the current head of the chain, from one snapshot. The
    // timestamp is rendered as text in UTC so it arrives as an unambiguous
    // ISO string rather than something Date has to guess at.
    const res = await db.execute(sql`
      SELECT
        to_char(
          date_trunc('milliseconds', now()) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS now_iso,
        (
          SELECT chain_hash FROM impersonation_sessions
          WHERE chain_hash IS NOT NULL
          ORDER BY id DESC
          LIMIT 1
        ) AS head_hash
    `);
    const head = res.rows[0] as Record<string, unknown>;
    const startedAt = new Date(String(head.now_iso));
    // No chained row yet — this is the first, and it anchors to genesis so
    // that deleting it later is detectable. Rows that predate the chain sit
    // before it with null hashes and are never claimed as verified.
    const prevHash =
      head.head_hash === null || head.head_hash === undefined
        ? impersonationGenesisHash(secret)
        : String(head.head_hash);

    const row: ImpersonationChainContent = { ...content, startedAt };

    try {
      const [inserted] = await db
        .insert(impersonationSessions)
        .values({
          ...content,
          startedAt,
          lastSeenAt: startedAt,
          chainPrevHash: prevHash,
          chainHash: impersonationRowHash(row, prevHash, secret),
        })
        .returning({ id: impersonationSessions.id });

      return inserted.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastError = err;
    }
  }

  // Callers must treat a throw as fatal and NOT enter the workspace — see the
  // note on startImpersonation. Entering with no audit row is the state this
  // table exists to eliminate, and that is still true when the reason for the
  // missing row is contention rather than an outage.
  throw new Error(
    `Could not append to the impersonation chain after ${CHAIN_APPEND_ATTEMPTS} ` +
      `attempts. Last error: ${String(lastError)}`,
  );
}

/**
 * Walk the whole log and report whether it still hangs together.
 *
 * The clean entry point for the admin console: it needs no arguments, opens no
 * decisions, and returns a value that already knows how to describe itself
 * (describeChainVerification in lib/impersonation-chain.ts).
 *
 * The WHOLE table, deliberately, with no limit. A chain verified from row 500
 * onwards proves nothing about the 499 rows someone might have edited, and a
 * check that silently examines a suffix while reporting on "the log" is the
 * kind of green tick this task exists to stop handing to a client. The table
 * grows by one row per operator visit; if it ever gets large enough for this
 * to hurt, the answer is periodic checkpointing, not a smaller window.
 */
export async function verifyImpersonationLog(): Promise<ChainVerification> {
  const rows = await db
    .select({
      id: impersonationSessions.id,
      adminId: impersonationSessions.adminId,
      adminEmail: impersonationSessions.adminEmail,
      adminClerkUserId: impersonationSessions.adminClerkUserId,
      workspaceId: impersonationSessions.workspaceId,
      workspaceName: impersonationSessions.workspaceName,
      reason: impersonationSessions.reason,
      startedAt: impersonationSessions.startedAt,
      chainPrevHash: impersonationSessions.chainPrevHash,
      chainHash: impersonationSessions.chainHash,
    })
    .from(impersonationSessions)
    .orderBy(asc(impersonationSessions.id));

  return verifyImpersonationChain(rows, chainSecret());
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

/**
 * A session that is still USABLE, by id. Null if it never existed, was closed,
 * or has gone quiet for longer than ABANDONED_AFTER_MS.
 *
 * ── WHY EXPIRY LIVES HERE AND NOT IN A REAPER JOB ──
 * This is the check that gates entry into a client's workspace (lib/viewer.ts),
 * so an open row was, until now, an access grant with no expiry: an operator
 * who closed their laptop mid-session left a session that still worked days
 * later. Session #5 sat open for hours on 23 August as exactly that.
 *
 * The obvious fix — a cron that stamps `ended_at = now()` on stale rows — was
 * deliberately NOT taken. `ended_at` means "we observed this session end", and
 * a reaper would be recording an exit nobody saw, at a time it did not happen.
 * This table is the answer to a client asking "did anyone at Postbox read my
 * customers' data, when, and for how long"; filling it with inferred exit times
 * makes it a worse answer while looking like a better one. `sessionState()`
 * already renders these honestly as "abandoned" — never observed to end.
 *
 * So: access expires on the HEARTBEAT, the log keeps saying what was actually
 * seen, and no scheduled job is needed at all. The row is closed properly if
 * the operator ever comes back — `startImpersonation` ends it as "switched".
 */
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
        // Expressed from the same constant the log uses, so "shown as
        // abandoned" and "refused" can never drift apart.
        gt(impersonationSessions.lastSeenAt, ABANDONED_CUTOFF),
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
