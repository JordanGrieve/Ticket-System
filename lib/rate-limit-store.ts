import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimit as rateLimitInMemory, type RateLimitResult } from "./rate-limit";

/**
 * Rate limiting that survives across serverless instances.
 *
 * ── WHY ──
 * lib/rate-limit.ts is a module-level Map. It is correct within one warm
 * instance and therefore decorative on Vercel: concurrency spreads requests
 * across instances, so every public limit is bypassed by making requests in
 * parallel. An adversarial review confirmed it, and it survived refutation.
 *
 * The endpoint where this actually bites is /api/subscribe/[key]. Each accepted
 * request sends an email TO A THIRD PARTY from our domain, so an unthrottled
 * signup form is a mail-bombing tool aimed at whatever address the attacker
 * types, charged to the sending reputation that carries every tenant's mail.
 *
 * ── IT FAILS OPEN, ONTO THE OLD LIMITER ──
 * If the database is unreachable this falls back to the in-memory limiter
 * rather than refusing. That is a deliberate choice and worth defending: these
 * are PUBLIC endpoints, and failing closed means a client's contact form
 * returns 429 to real customers for as long as the outage lasts — silently,
 * because a form that rejects everyone looks exactly like a form nobody is
 * using. This project has already lost six weeks to precisely that failure
 * mode.
 *
 * So a database outage degrades protection to what it was yesterday, rather
 * than to nothing, and never takes a client's form down with it.
 */

/**
 * One atomic upsert. The decision is made by the database, not read-then-write,
 * so two concurrent requests cannot both see "count = max - 1" and both pass.
 *
 * The window is reset inside the same statement when it has expired, which is
 * why there is no separate "is it stale" read. `count` is incremented even for
 * a request that ends up refused — this is a fixed window, so that does not
 * extend the block, and skipping it would need a second round trip to find out.
 */
export async function rateLimitDurable(
  key: string,
  { max = 60, windowMs = 60_000 }: { max?: number; windowMs?: number } = {},
): Promise<RateLimitResult> {
  const seconds = Math.max(1, Math.round(windowMs / 1000));

  try {
    const res = await db.execute(sql`
      INSERT INTO rate_limits (bucket, window_start, count)
      VALUES (${key}, now(), 1)
      ON CONFLICT (bucket) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < now() - (${seconds} * interval '1 second')
            THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < now() - (${seconds} * interval '1 second')
            THEN now()
          ELSE rate_limits.window_start
        END
      RETURNING
        count,
        -- Seconds until this window expires, computed by the same clock that
        -- opened it. Doing this arithmetic in JS would compare the database's
        -- window against the app instance's clock.
        GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (
            window_start + (${seconds} * interval '1 second') - now()
          )))
        )::int AS retry_after
    `);

    const row = res.rows[0] as { count: number; retry_after: number } | undefined;
    if (!row) throw new Error("rate_limits upsert returned no row");

    const count = Number(row.count);
    const ok = count <= max;
    return {
      ok,
      limit: max,
      remaining: Math.max(0, max - count),
      retryAfterSeconds: ok ? 0 : Number(row.retry_after),
    };
  } catch (err) {
    // See the header: degrade to the old limiter, never take the form down.
    console.error("[rate-limit] durable store unavailable, using memory:", err);
    // degraded:true is the whole point of the fallback being visible. Without
    // it a caller cannot tell a shared count from a per-instance one, and a
    // caller that needs to fail closed has to re-derive the fact with an extra
    // query. See RateLimitResult.degraded.
    return { ...rateLimitInMemory(key, { max, windowMs }), degraded: true };
  }
}

/**
 * Delete windows that have long expired.
 *
 * Without this the table grows one row per distinct bucket forever, and the
 * IP-keyed buckets on the public endpoints mean that is one row per distinct
 * visitor. Called from the daily health sweep.
 *
 * ⚠️ THE INTERVAL MUST EXCEED THE LONGEST WINDOW IN USE, BY A LOT.
 * Deleting a row mid-count does not just lose a statistic — it RESETS the
 * counter, so the next request starts a fresh window and a caller that should
 * have been refused is let through.
 *
 * This originally said "an hour of slack past the longest window in use (10
 * minutes, on test-send)" and deleted at one hour. That was already false when
 * written down a few hours later: the auto-reply mail-loop guards use
 * 60-MINUTE windows, so the margin was zero and a 61-minute window would have
 * been truncated silently. Caught in review, not by a test — there is no
 * assertion tying this interval to the windows the code actually uses, which
 * is the real weakness here.
 *
 * 24 hours is far past anything plausible, and the table is bounded by
 * distinct buckets rather than by traffic, so the extra rows cost nothing.
 */
export async function pruneRateLimits(): Promise<number> {
  try {
    const res = await db.execute(sql`
      DELETE FROM rate_limits
      WHERE window_start < now() - interval '24 hours'
      RETURNING bucket
    `);
    return res.rows.length;
  } catch (err) {
    console.error("[rate-limit] prune failed:", err);
    return 0;
  }
}
