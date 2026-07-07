/**
 * Per-workspace rate limiting for the public ingestion endpoint, so one
 * client's traffic (or abuse) can never affect another's.
 *
 * This is an in-memory fixed-window limiter. It is correct within a single
 * serverless instance; for strict cross-instance limits in production, swap
 * the store for Upstash Redis (same interface). The window is intentionally
 * generous — it's a safety valve against runaway loops, not a paywall.
 */

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000; // 1 minute
const MAX_PER_WINDOW = 60; // 60 submissions / minute / workspace

// Module-level map persists across requests on a warm instance.
const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  { max = MAX_PER_WINDOW, windowMs = WINDOW_MS }: { max?: number; windowMs?: number } = {},
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, limit: max, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    return {
      ok: false,
      remaining: 0,
      limit: max,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: max - existing.count,
    limit: max,
    retryAfterSeconds: 0,
  };
}
