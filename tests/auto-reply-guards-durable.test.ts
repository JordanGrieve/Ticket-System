import { describe, it, expect } from "vitest";
import {
  checkAutoReplyRateLimits,
  type AutoReplyLimiter,
} from "../lib/auto-reply-guards";
import type { RateLimitResult } from "../lib/rate-limit";

/**
 * The mail-loop rate limits, now backed by the durable (Postgres) counter.
 *
 * These tests run with NO DATABASE, deliberately: the limiter is injected into
 * `checkAutoReplyRateLimits`, so lib/rate-limit-store.ts (which carries
 * `server-only` and imports the db) never enters this module graph. What is
 * asserted here is the part that is ours rather than the store's — the bucket
 * keys, the limits, the short-circuit ORDER, and above all that this guard
 * fails CLOSED when the counter cannot be read.
 */

type Call = { key: string; opts: { max: number; windowMs: number } };

const OK: RateLimitResult = { ok: true, limit: 1, remaining: 0, retryAfterSeconds: 0 };
const DENY: RateLimitResult = { ok: false, limit: 1, remaining: 0, retryAfterSeconds: 30 };

/**
 * A limiter that records every call and answers from a script. `undefined` in
 * the script means "allow"; anything else is returned as-is; an Error is
 * thrown, which is how a database failure reaches the guard.
 */
function fakeLimiter(script: Array<RateLimitResult | Error | undefined> = []) {
  const calls: Call[] = [];
  const limiter: AutoReplyLimiter = async (key, opts) => {
    const next = script[calls.length];
    calls.push({ key, opts });
    if (next instanceof Error) throw next;
    return next ?? OK;
  };
  return { limiter, calls };
}

describe("checkAutoReplyRateLimits — buckets and limits", () => {
  it("allows a send and consumes all three counters", async () => {
    const { limiter, calls } = fakeLimiter();
    const r = await checkAutoReplyRateLimits(7, "alex@example.com", limiter);

    expect(r).toEqual({ ok: true });
    expect(calls.map((c) => c.key)).toEqual([
      "autoreply:ws:7",
      "autoreply:to10:7:alex@example.com",
      "autoreply:to60:7:alex@example.com",
    ]);
  });

  it("keeps the configured windows: 60/hour per workspace, 1/10min then 3/hour per recipient", async () => {
    const { limiter, calls } = fakeLimiter();
    await checkAutoReplyRateLimits(7, "alex@example.com", limiter);

    expect(calls[0].opts).toEqual({ max: 60, windowMs: 60 * 60 * 1000 });
    expect(calls[1].opts).toEqual({ max: 1, windowMs: 10 * 60 * 1000 });
    expect(calls[2].opts).toEqual({ max: 3, windowMs: 60 * 60 * 1000 });
  });

  it("normalises the recipient, so casing and whitespace share one bucket", async () => {
    // A loop that alternated Alex@ and alex@ would otherwise get a fresh
    // counter on every round trip.
    const a = fakeLimiter();
    await checkAutoReplyRateLimits(7, "  ALEX@Example.COM ", a.limiter);
    const b = fakeLimiter();
    await checkAutoReplyRateLimits(7, "alex@example.com", b.limiter);

    expect(a.calls.map((c) => c.key)).toEqual(b.calls.map((c) => c.key));
  });

  it("keys per workspace, so one tenant's loop cannot exhaust another's budget", async () => {
    const a = fakeLimiter();
    await checkAutoReplyRateLimits(7, "alex@example.com", a.limiter);
    const b = fakeLimiter();
    await checkAutoReplyRateLimits(8, "alex@example.com", b.limiter);

    expect(a.calls[1].key).not.toEqual(b.calls[1].key);
  });
});

describe("checkAutoReplyRateLimits — refusal short-circuits", () => {
  it("stops at the workspace counter and never touches the recipient ones", async () => {
    const { limiter, calls } = fakeLimiter([DENY]);
    const r = await checkAutoReplyRateLimits(7, "alex@example.com", limiter);

    expect(r).toEqual({ ok: false, scope: "workspace" });
    // The order matters: a send already refused must not consume the
    // per-recipient budget, or a workspace flood would blind the guard that
    // actually breaks robot ping-pong.
    expect(calls).toHaveLength(1);
  });

  it("stops at the 10-minute burst and never reaches the hourly counter", async () => {
    const { limiter, calls } = fakeLimiter([undefined, DENY]);
    const r = await checkAutoReplyRateLimits(7, "alex@example.com", limiter);

    expect(r).toEqual({ ok: false, scope: "recipient" });
    expect(calls).toHaveLength(2);
  });

  it("refuses on the hourly recipient cap", async () => {
    const { limiter, calls } = fakeLimiter([undefined, undefined, DENY]);
    const r = await checkAutoReplyRateLimits(7, "alex@example.com", limiter);

    expect(r).toEqual({ ok: false, scope: "recipient" });
    expect(calls).toHaveLength(3);
  });
});

describe("checkAutoReplyRateLimits — FAILS CLOSED", () => {
  /**
   * The judgement this whole change turns on. lib/rate-limit-store.ts fails
   * OPEN onto the in-memory limiter, which is right for a public form and wrong
   * for a mail-loop guard: an uncountable send must be a refused send, because
   * failing closed costs one acknowledgement while failing open can cost the
   * sending reputation that carries every tenant's mail.
   */
  it.each([0, 1, 2])(
    "refuses when the counter throws at position %i",
    async (position) => {
      const script: Array<RateLimitResult | Error | undefined> = [];
      script[position] = new Error("connection terminated unexpectedly");
      const { limiter, calls } = fakeLimiter(script);

      const r = await checkAutoReplyRateLimits(7, "alex@example.com", limiter);

      expect(r).toEqual({ ok: false, scope: "unavailable" });
      // …and it stops there rather than pressing on with the counters it can
      // still reach, which would report a partially-counted send as allowed.
      expect(calls).toHaveLength(position + 1);
    },
  );

  it("never reports ok when the limiter is entirely unavailable", async () => {
    const limiter: AutoReplyLimiter = async () => {
      throw new Error("rate_limits does not exist");
    };
    const r = await checkAutoReplyRateLimits(7, "alex@example.com", limiter);
    expect(r.ok).toBe(false);
  });
});
