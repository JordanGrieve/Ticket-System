import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { IngestionFailureReason } from "@/db/schema";

/**
 * Record that a public ingestion request was rejected.
 *
 * ── WHY ──
 * Open Door Bakery's contact form posted a key that no longer existed, every
 * day, for six weeks. Postbox returned 401 to every request — correctly — and
 * threw the fact away. Nobody could have found it without the client
 * complaining, because nothing anywhere recorded that the attempts had
 * happened at all.
 *
 * lib/workspace-health.ts now infers that a workspace has stopped receiving.
 * This records WHY, which is the difference between "something is wrong with
 * this client" and "their site is posting a key we don't recognise".
 *
 * ── BEST EFFORT, ALWAYS ──
 * Every function here swallows its own errors. This is called from the failure
 * path of a public endpoint; a logging table that can turn a tidy 401 into a
 * 500 is a worse bug than the one it was added to diagnose.
 */

/** Recognisable, never reusable. */
const KEY_PREFIX_LENGTH = 16;

/**
 * Shape of a key this product issues. Only these are recorded.
 *
 * Without it, internet background scanning — and anyone curling the endpoint
 * with junk — writes one row per distinct random string, and the table that
 * exists to make a real broken integration visible becomes the place that
 * signal hides. A stale or rotated key still looks like one of ours, which is
 * the case worth catching.
 */
const KEY_SHAPE = /^cli_[A-Za-z0-9_]{4,}$/;

function prefixOf(key: string): string | null {
  const trimmed = (key ?? "").trim();
  if (!KEY_SHAPE.test(trimmed)) return null;
  return trimmed.slice(0, KEY_PREFIX_LENGTH);
}

/**
 * Upsert one aggregated row.
 *
 * ONE ROW PER (reason, key_prefix), with a count — never a row per request.
 * A row-per-request log on an unauthenticated endpoint whose key is published
 * in the client's own page source is a free database-growth primitive for
 * anyone who views source. The unique index bounds this by distinct keys
 * rather than by traffic.
 */
export async function recordIngestionFailure(input: {
  reason: IngestionFailureReason;
  key: string;
  /** Only when the key was valid and the BODY failed. Null otherwise. */
  workspaceId?: number | null;
}): Promise<void> {
  const keyPrefix = prefixOf(input.key);
  if (!keyPrefix) return;

  try {
    await db.execute(sql`
      INSERT INTO ingestion_failures (reason, key_prefix, workspace_id)
      VALUES (${input.reason}, ${keyPrefix}, ${input.workspaceId ?? null})
      ON CONFLICT (reason, key_prefix) DO UPDATE
      SET count = ingestion_failures.count + 1,
          last_seen_at = now(),
          -- Fill in the workspace if we have learned it since, but never blank
          -- one we already knew. COALESCE order matters: the stored value wins.
          workspace_id = COALESCE(ingestion_failures.workspace_id, EXCLUDED.workspace_id)
    `);
  } catch (err) {
    // Never fail the request over telemetry. See the header.
    console.error("[ingestion-log] could not record failure:", err);
  }
}

export type IngestionFailureRow = {
  reason: IngestionFailureReason;
  keyPrefix: string;
  workspaceId: number | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

/**
 * Recent rejections, worst first. For the admin console.
 *
 * Ordered by count rather than recency on purpose: one stray curl is noise,
 * four thousand attempts with the same unknown key is a client whose website
 * has been broken since the day they installed it.
 */
export async function recentIngestionFailures(
  limit = 20,
): Promise<IngestionFailureRow[]> {
  try {
    const res = await db.execute(sql`
      SELECT reason, key_prefix, workspace_id, count, first_seen_at, last_seen_at
      FROM ingestion_failures
      ORDER BY count DESC, last_seen_at DESC
      LIMIT ${limit}
    `);
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        reason: String(row.reason) as IngestionFailureReason,
        keyPrefix: String(row.key_prefix),
        workspaceId: row.workspace_id === null ? null : Number(row.workspace_id),
        count: Number(row.count),
        firstSeenAt: new Date(String(row.first_seen_at)),
        lastSeenAt: new Date(String(row.last_seen_at)),
      };
    });
  } catch (err) {
    console.error("[ingestion-log] could not read failures:", err);
    return [];
  }
}
