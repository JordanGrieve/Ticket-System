import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { adminActions } from "@/db/schema";
import type { AdminActionKind } from "@/db/schema";

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
  await db.insert(adminActions).values({
    action: input.action,
    actorAdminId: input.actorAdminId,
    actorEmail: input.actorEmail.trim().slice(0, 320),
    targetId: input.targetId ?? null,
    // Capped because these are names and addresses somebody typed.
    targetLabel: (input.targetLabel ?? "").trim().slice(0, 200) || null,
    detail: (input.detail ?? "").trim().slice(0, 500) || null,
  });
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
