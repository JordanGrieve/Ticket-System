/**
 * The DEGRADED-MODE rate limiter. Nothing calls this directly any more.
 *
 * ── WHAT IT IS FOR NOW ──
 * An in-memory fixed-window limiter, correct within a single serverless
 * instance and therefore not a real limit on Vercel, where concurrency spreads
 * requests across instances. Since 23 August 2026 its only caller is
 * lib/rate-limit-store.ts, which falls back to it when the database is
 * unreachable: a database outage degrades protection to what it was yesterday
 * rather than to nothing, and never takes a client's contact form down.
 *
 * That makes this file load-bearing rather than legacy, which is easy to get
 * wrong — a search for callers that filters out "rate-limit-store" finds none
 * and concludes it is dead. It is not.
 *
 * ── AND WHAT IT IS NOT FOR ──
 * It used to be the primary limiter on /api/tickets/[id]/reply, test-send and
 * the workspace export. Those moved to the durable store, because a limit that
 * resets per instance is close to no limit at all and the reply route sends
 * real email from our domain.
 *
 * The header used to recommend swapping the store for Upstash Redis. That is
 * no longer the plan: the durable limiter uses Postgres, which is already on
 * the request path and needs no second paid service. Upstash would still be
 * the better answer at volume — this is not it.
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
  /**
   * True when this answer came from the per-instance fallback rather than the
   * shared store — i.e. the count is NOT authoritative across instances.
   *
   * It exists so a caller can choose its own failure semantics. The public
   * endpoints treat a degraded answer as good enough: a contact form that 429s
   * everyone through a database outage looks exactly like a form nobody is
   * using. The auto-reply mail-loop guards treat it as a refusal, because the
   * cost there is a courtesy message rather than a lost enquiry, and because a
   * running loop generates exactly the load that makes the store stop
   * answering — the moment it degrades is the moment it matters most.
   *
   * Optional so the in-memory limiter, which is always degraded by definition,
   * does not have to say so at every return.
   */
  degraded?: boolean;
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
