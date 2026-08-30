import "server-only";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminActions } from "@/db/schema";
import type { AdminActionKind } from "@/db/schema";
import {
  ADMIN_CHAIN_SECRET_ENV,
  adminActionGenesisHash,
  adminActionRowHash,
  verifyAdminActionChain,
  type AdminActionChainContent,
} from "./admin-actions-chain";
import type { ChainVerification } from "./hash-chain";

/**
 * The operator action log.
 *
 * lib/impersonation.ts records an operator ENTERING a client's workspace.
 * This records what they did to the platform: created a workspace, deleted
 * one, granted super-admin, revoked it. Those four are the actions with no
 * tenant on the other side to notice them, which is exactly why they need
 * writing down.
 *
 * The one that matters most is the deletion. deleteClientAction cascades away
 * every ticket, message, label and subscriber a client had, and before this
 * nothing recorded that it happened, let alone who did it.
 *
 * ── FAIL-CLOSED, UNLIKE THE OTHER TWO LOGS IN THIS CODEBASE ──
 * lib/ingestion-log.ts and lib/feedback-log.ts both swallow their own errors,
 * because they run on the failure path of a public endpoint and a logging
 * table that turns a tidy 401 into a 500 is worse than the gap it fills.
 *
 * This one throws. It is called from a server action performed by a signed-in
 * operator, immediately BEFORE an irreversible mutation, and the caller treats
 * a throw as "do not proceed". An operator seeing "could not record that, try
 * again" is a mildly annoying afternoon. A client's workspace disappearing
 * with no record of who removed it is the thing this exists to prevent, and
 * silently swallowing the write would reintroduce it in the one case where the
 * database is already unhappy.
 */

export async function recordAdminAction(input: {
  action: AdminActionKind;
  actorAdminId: number | null;
  actorEmail: string;
  /** Workspace or admin id. Stored as a plain integer, never a foreign key. */
  targetId?: number | null;
  /** The target's name or email AS IT IS NOW — it may not exist afterwards. */
  targetLabel?: string | null;
  detail?: string | null;
}): Promise<void> {
  const secret = chainSecret();
  const content = {
    action: input.action,
    actorAdminId: input.actorAdminId,
    actorEmail: input.actorEmail.trim().slice(0, 320),
    targetId: input.targetId ?? null,
    // Capped because these are names and addresses somebody typed.
    targetLabel: (input.targetLabel ?? "").trim().slice(0, 200) || null,
    detail: (input.detail ?? "").trim().slice(0, 500) || null,
  };

  let lastError: unknown = null;

  for (let attempt = 0; attempt < CHAIN_APPEND_ATTEMPTS; attempt++) {
    /*
      The clock and the current head of the chain from ONE snapshot. The
      timestamp is rendered as text in UTC so it arrives as an unambiguous ISO
      string rather than something Date has to guess at, and truncated to
      milliseconds because Postgres timestamptz carries microseconds a JS Date
      cannot hold — a row hashed from a Date and re-read later would otherwise
      disagree with itself on digits nobody can see.
    */
    const res = await db.execute(sql`
      SELECT
        to_char(
          date_trunc('milliseconds', now()) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS now_iso,
        (
          SELECT chain_hash FROM admin_actions
          WHERE chain_hash IS NOT NULL
          ORDER BY id DESC
          LIMIT 1
        ) AS head_hash
    `);
    const head = res.rows[0] as Record<string, unknown>;
    const createdAt = new Date(String(head.now_iso));
    // No chained row yet — this is the first, and it anchors to genesis so
    // that deleting it later is detectable.
    const prevHash =
      head.head_hash === null || head.head_hash === undefined
        ? adminActionGenesisHash(secret)
        : String(head.head_hash);

    const row: AdminActionChainContent = { ...content, createdAt };

    try {
      await db.insert(adminActions).values({
        ...content,
        createdAt,
        chainPrevHash: prevHash,
        chainHash: adminActionRowHash(row, prevHash, secret),
      });
      return;
    } catch (err) {
      // A lost race for the head of the chain, which the unique index on
      // chain_prev_hash turns into a constraint violation rather than a fork.
      // Anything else is a real failure and must reach the caller.
      if (!isUniqueViolation(err)) throw err;
      lastError = err;
    }
  }

  throw new Error(
    `Could not append to the operator action log after ${CHAIN_APPEND_ATTEMPTS} ` +
      `attempts: ${String(lastError)}`,
  );
}

/**
 * The secret that turns this chain from a checksum into something a
 * DATABASE_URL holder cannot forge. Absent is supported — the chain still
 * catches accidents — and verification reports which, so nothing claims more
 * than it has.
 *
 * Read at call time rather than at module load, so setting it in the
 * deployment environment takes effect on the next request rather than the next
 * cold start.
 */
function chainSecret(): string | null {
  return process.env[ADMIN_CHAIN_SECRET_ENV] || null;
}

/**
 * How many times an append may lose the race for the head before giving up.
 * Contention is close to theoretical here — it needs two operators performing
 * platform actions in the same instant — but the retry is what makes the
 * unique index a correctness mechanism rather than an outage.
 */
const CHAIN_APPEND_ATTEMPTS = 5;

/** Postgres unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "23505";
}

/**
 * Walk the action chain and report whether it still holds.
 *
 * Fails SOFT, unlike the append. A console that will not render because the
 * verifier threw tells an operator nothing; an unverified chain reported as
 * unverified tells them exactly what is true.
 */
export async function verifyAdminActionLog(): Promise<ChainVerification> {
  try {
    const rows = await db
      .select({
        id: adminActions.id,
        action: adminActions.action,
        actorAdminId: adminActions.actorAdminId,
        actorEmail: adminActions.actorEmail,
        targetId: adminActions.targetId,
        targetLabel: adminActions.targetLabel,
        detail: adminActions.detail,
        createdAt: adminActions.createdAt,
        chainPrevHash: adminActions.chainPrevHash,
        chainHash: adminActions.chainHash,
      })
      .from(adminActions)
      .orderBy(adminActions.id);

    return verifyAdminActionChain(rows, chainSecret());
  } catch (err) {
    console.error("[admin-audit] could not verify the action chain:", err);
    return {
      ok: false,
      keyed: chainSecret() !== null,
      total: 0,
      legacyUnverified: 0,
      verified: 0,
      firstBreak: null,
      note: "The action log could not be read, so nothing was verified. This is a database error, not evidence of tampering.",
    };
  }
}

export type AdminActionRow = {
  id: number;
  action: AdminActionKind;
  actorEmail: string;
  targetId: number | null;
  targetLabel: string | null;
  detail: string | null;
  createdAt: Date;
};

/**
 * Newest first, capped.
 *
 * Unlike feedback_drops this table is append-only and unaggregated — one row
 * per action, because "how many workspaces were deleted" is not the question;
 * "which one, by whom, when" is. It grows with operator activity rather than
 * with traffic, so a handful of rows a week at most.
 */
export async function recentAdminActions(limit = 50): Promise<AdminActionRow[]> {
  try {
    return await db
      .select({
        id: adminActions.id,
        action: adminActions.action,
        actorEmail: adminActions.actorEmail,
        targetId: adminActions.targetId,
        targetLabel: adminActions.targetLabel,
        detail: adminActions.detail,
        createdAt: adminActions.createdAt,
      })
      .from(adminActions)
      .orderBy(desc(adminActions.createdAt))
      .limit(limit);
  } catch (err) {
    // Reading is not on any critical path; an empty list beats a 500 on the
    // console page. Writing is the half that must not be silent.
    console.error("[admin-audit] could not read the action log:", err);
    return [];
  }
}

/** Operator-facing wording. Says what happened, not what the column holds. */
export function describeAdminAction(action: AdminActionKind): string {
  switch (action) {
    case "workspace_created":
      return "Created workspace";
    case "workspace_deleted":
      return "Deleted workspace";
    case "admin_granted":
      return "Granted super-admin";
    case "admin_revoked":
      return "Revoked super-admin";
  }
}

/**
 * Whether an action destroyed something.
 *
 * Used to mark the row in the console. The two destructive entries are the
 * reason the table exists, and a log where a deletion looks the same as a
 * creation makes somebody read every line to find the one that mattered.
 */
export function isDestructiveAdminAction(action: AdminActionKind): boolean {
  return action === "workspace_deleted" || action === "admin_revoked";
}
