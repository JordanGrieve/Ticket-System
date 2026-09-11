import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { PROVIDER_DAILY_CAP, providerDayBucket, quotaState, type QuotaState } from "./email-quota";

/**
 * The IO half of the transactional daily counter. See lib/email-quota.ts.
 *
 * ── WHY rate_limits AND NOT usage_counters ──
 * `usage_counters` is per WORKSPACE per MONTH, and is what a bill is drawn
 * from. This is a PLATFORM-wide ceiling on a shared provider account, per
 * DAY: a different grain and a different owner. Squeezing it into the billing
 * table would need a workspace id it does not have, and would put a fact
 * about our Resend plan next to facts about what a client owes.
 *
 * `rate_limits` is bucket + window + count, keyed by an opaque string, with
 * one atomic upsert already written and already pruned by the daily health
 * sweep. This is exactly its shape.
 */

/*
 * ── NO WINDOW ARITHMETIC HERE, AND WHY THAT IS SAFE ──
 * rateLimitDurable resets its count when the window expires, because it
 * enforces a rolling limit. This does not: the calendar date is in the bucket
 * KEY, so a new day is a new row and today's row never needs resetting.
 * `window_start` is stamped once, on insert, and left alone.
 *
 * That leaves it to pruneRateLimits to clear the old rows, which deletes
 * anything whose window_start is over 24 hours old. The coupling is worth
 * stating because it could go wrong: a bucket opened at 00:05 UTC is 24 hours
 * old at 00:05 the next day, by which time its day has rolled and nothing
 * reads it again. The daily sweep runs at 09:00, so it only ever meets
 * yesterday's row. A current day's row cannot be older than the sweep's own
 * hour, so it cannot be pruned out from under the count.
 */

/**
 * Count one transactional email that has LEFT.
 *
 * Called after a successful provider call, never before: this number's only
 * job is to say how close the shared account is to its ceiling, and counting
 * attempts would overstate it every time an address bounced at the door.
 *
 * Swallows its own errors, deliberately and for the same reason
 * `recordUsage` does: the email is already gone. Failing the caller here
 * would turn a counter outage into a delivery outage, which is the wrong way
 * round for a number nobody reads until tomorrow morning.
 */
export async function recordTransactionalSend(now = new Date()): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO rate_limits (bucket, window_start, count)
      VALUES (${providerDayBucket(now)}, now(), 1)
      ON CONFLICT (bucket) DO UPDATE SET
        count = rate_limits.count + 1
    `);
  } catch (err) {
    console.error("[email-quota] could not record a send:", err);
  }
}

/**
 * How much of today's ceiling has gone.
 *
 * THROWS rather than returning a zero, and the distinction matters: zero is a
 * quiet morning, an unreadable counter is "we do not know", and a health
 * check that cannot tell those apart would report a healthy day every time
 * the database was unreachable. The caller decides what to do with not
 * knowing — app/api/cron/health treats it as its own alert.
 */
export async function transactionalSentToday(now = new Date()): Promise<QuotaState> {
  const res = await db.execute(sql`
    SELECT count FROM rate_limits WHERE bucket = ${providerDayBucket(now)}
  `);
  const row = res.rows[0] as { count: number } | undefined;
  return quotaState(row ? Number(row.count) : 0, PROVIDER_DAILY_CAP);
}
