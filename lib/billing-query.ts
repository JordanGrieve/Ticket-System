import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { entitlement, type Entitlement } from "./trial";

/**
 * The database half of entitlement. lib/trial.ts holds the rules and knows
 * nothing about storage; this reads the numbers and hands them over.
 *
 * `server-only`: this pulls in db/index.ts, and lib/trial.ts must stay
 * importable from anywhere — including tests that run with no DATABASE_URL,
 * which is the whole reason the rules live apart from the reads.
 */

/**
 * What this workspace may currently do.
 *
 * Returns null when the workspace does not exist. Callers should treat null as
 * "do not block": a missing workspace is a bug somewhere else, and failing
 * OPEN here means the worst case is one send that should have been refused,
 * rather than every send in the product stopping because a query changed shape.
 * Same fail-open reasoning as the rate limiter.
 */
export async function getWorkspaceEntitlement(
  workspaceId: number,
): Promise<Entitlement | null> {
  const [ws] = await db
    .select({
      plan: workspaces.plan,
      trialStartedAt: workspaces.trialStartedAt,
      stripeSubscriptionId: workspaces.stripeSubscriptionId,
      currentPeriodEnd: workspaces.currentPeriodEnd,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!ws) return null;

  // Only counted for trials. A paid plan's limits are not enforced by refusing
  // to send — an overage is a conversation, not a wall — and counting on every
  // send would put two aggregate queries on the hot path for no benefit.
  if (ws.plan !== "trial") {
    return entitlement(ws, { tickets: 0, subscribers: 0 }, new Date());
  }

  const [counts] = await db
    .select({
      tickets: sql<number>`(
        SELECT count(*)::int FROM tickets t
        WHERE t.workspace_id = ${workspaceId}
          AND t.created_at >= ${ws.trialStartedAt}
      )`,
      // Confirmed subscribers only. Somebody who submitted a form and never
      // pressed the link is not stored at all, so this cannot be inflated by
      // a stranger typing addresses into a public form — which would otherwise
      // be a way to end another business's trial for them.
      subscribers: sql<number>`(
        SELECT count(*)::int FROM subscribers s
        WHERE s.workspace_id = ${workspaceId}
          AND s.status = 'subscribed'
      )`,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return entitlement(
    ws,
    { tickets: counts?.tickets ?? 0, subscribers: counts?.subscribers ?? 0 },
    new Date(),
  );
}
