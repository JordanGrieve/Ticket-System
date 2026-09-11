import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { usageCounters } from "@/db/schema";
import { periodKey, type UsageMetric } from "./usage";

/**
 * Reading and writing the usage counters. lib/usage.ts is the pure half.
 *
 * ── EVERY WRITE IS ONE STATEMENT ──
 * `INSERT … ON CONFLICT DO UPDATE` computes the new value inside the database,
 * under the row lock the upsert takes. There is no read-then-write anywhere in
 * this file, because two sweeps incrementing the same workspace in the same
 * second is the normal case rather than the edge one — the campaign sweep and
 * the auto-reply sweep both run unattended and neither knows about the other.
 *
 * ── RECORDING NEVER FAILS A SEND ──
 * `recordUsage` swallows its own errors, on the same principle as
 * lib/ingestion-log.ts. The email has already left; a counter that could not
 * be written is an accounting problem, and throwing here would turn it into a
 * customer's message not arriving. The read side fails closed instead — see
 * `usedThisMonth`.
 */

/**
 * Add to a counter. Best effort.
 *
 * Returns the new total when it could be written, and null when it could not,
 * so a caller that wants to log the difference can. Nobody has to check it.
 */
export async function recordUsage(
  workspaceId: number,
  metric: UsageMetric,
  amount: number,
  now: Date = new Date(),
): Promise<number | null> {
  if (amount <= 0) return null;
  const period = periodKey(now);

  try {
    const res = await db.execute(sql`
      INSERT INTO usage_counters (workspace_id, metric, period, count, updated_at)
      VALUES (${workspaceId}, ${metric}, ${period}, ${amount}, now())
      ON CONFLICT (workspace_id, metric, period) DO UPDATE SET
        count = usage_counters.count + ${amount},
        updated_at = now()
      RETURNING count
    `);
    const row = res.rows[0] as { count: number } | undefined;
    return row ? Number(row.count) : null;
  } catch (err) {
    console.error(
      "[usage] could not record %s +%d for workspace %d:",
      metric,
      amount,
      workspaceId,
      err,
    );
    return null;
  }
}

/**
 * What this workspace has used this month.
 *
 * ── THIS ONE THROWS ──
 * Unlike `recordUsage`, and deliberately. Its caller is deciding whether a
 * send is allowed, and a read that failed open would let an unreadable
 * database mean "unlimited" — which is the failure mode that empties an SES
 * account. The send path catches it and refuses the batch, leaving every row
 * queued and retryable, which costs nothing.
 */
export async function usedThisMonth(
  workspaceId: number,
  metric: UsageMetric,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.workspaceId, workspaceId),
        eq(usageCounters.metric, metric),
        eq(usageCounters.period, periodKey(now)),
      ),
    )
    .limit(1);
  // No row means nothing used yet this month, which is zero rather than
  // unknown — the counter is created on first use, not on workspace creation.
  return row ? Number(row.count) : 0;
}
