import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { rateLimit } from "../lib/rate-limit";

/**
 * The in-memory limiter had no coverage at all, which matters more than its
 * size suggests: it is the LAST line of defence against an auto-reply loop.
 * lib/auto-reply.ts leans on it explicitly — two autoresponders open a new
 * ticket on every round, so the per-ticket "already answered" guard never
 * fires against them and only "we already mailed this address recently"
 * breaks the cycle.
 *
 * Buckets are module-level state keyed by string, so every test uses a unique
 * key rather than trying to reset the map.
 */

let n = 0;
const key = (label: string) => `test:${label}:${n++}`;

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows up to `max` in a window, then refuses", () => {
    const k = key("basic");
    expect(rateLimit(k, { max: 3 }).ok).toBe(true);
    expect(rateLimit(k, { max: 3 }).ok).toBe(true);
    expect(rateLimit(k, { max: 3 }).ok).toBe(true);
    expect(rateLimit(k, { max: 3 }).ok).toBe(false);
  });

  it("counts down `remaining` and reports the limit", () => {
    const k = key("remaining");
    expect(rateLimit(k, { max: 2 })).toMatchObject({ ok: true, remaining: 1, limit: 2 });
    expect(rateLimit(k, { max: 2 })).toMatchObject({ ok: true, remaining: 0, limit: 2 });
    const blocked = rateLimit(k, { max: 2 });
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("gives a positive Retry-After once blocked", () => {
    const k = key("retry");
    rateLimit(k, { max: 1, windowMs: 60_000 });
    const blocked = rateLimit(k, { max: 1, windowMs: 60_000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps separate keys independent — one tenant cannot exhaust another", () => {
    const a = key("tenant-a");
    const b = key("tenant-b");
    expect(rateLimit(a, { max: 1 }).ok).toBe(true);
    expect(rateLimit(a, { max: 1 }).ok).toBe(false);
    // b is untouched by a's exhaustion.
    expect(rateLimit(b, { max: 1 }).ok).toBe(true);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    const k = key("window");
    expect(rateLimit(k, { max: 1, windowMs: 1000 }).ok).toBe(true);
    expect(rateLimit(k, { max: 1, windowMs: 1000 }).ok).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rateLimit(k, { max: 1, windowMs: 1000 }).ok).toBe(true);
  });

  it("does not reset early — the window is honoured", () => {
    vi.useFakeTimers();
    const k = key("no-early-reset");
    expect(rateLimit(k, { max: 1, windowMs: 10_000 }).ok).toBe(true);
    vi.advanceTimersByTime(9_000);
    expect(rateLimit(k, { max: 1, windowMs: 10_000 }).ok).toBe(false);
  });

  it("is a fixed window, so a burst can straddle the boundary", () => {
    // Documenting real behaviour, not endorsing it: `max` per window means up
    // to 2*max across a boundary. Fine for a safety valve, and the reason
    // lib/auto-reply.ts layers a 10-minute AND a 60-minute recipient limit.
    vi.useFakeTimers();
    const k = key("straddle");
    expect(rateLimit(k, { max: 2, windowMs: 1000 }).ok).toBe(true);
    expect(rateLimit(k, { max: 2, windowMs: 1000 }).ok).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(rateLimit(k, { max: 2, windowMs: 1000 }).ok).toBe(true);
    expect(rateLimit(k, { max: 2, windowMs: 1000 }).ok).toBe(true);
  });
});

describe("only the durable store may use the in-memory limiter", () => {
  /*
   * lib/rate-limit.ts is a module-level Map, so on Vercel it counts per
   * instance and concurrency walks straight past it. Since 23 Aug 2026 its one
   * legitimate caller is lib/rate-limit-store.ts, which falls back to it when
   * the database is unreachable.
   *
   * Anything else importing it is a public limit that silently is not one. The
   * reply endpoint had exactly that shape and sends real email from our domain.
   */
  const ROOT = join(__dirname, "..");

  function sourcesUnder(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const p = join(d, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry)) out.push(p);
      }
    };
    walk(join(ROOT, dir));
    return out.map((p) => p.slice(ROOT.length + 1).split("\\").join("/"));
  }

  it("no route or component imports rateLimit directly", () => {
    const offenders: string[] = [];

    for (const file of [...sourcesUnder("app"), ...sourcesUnder("lib")]) {
      if (file === "lib/rate-limit.ts" || file === "lib/rate-limit-store.ts") {
        continue;
      }
      const src = readFileSync(join(ROOT, file), "utf8");

      // Type-only imports are fine: RateLimitResult is the shared shape and
      // erases at compile time. It is the VALUE import that would mean a real
      // per-instance limit guarding a public endpoint.
      const valueImport =
        /import\s+\{[^}]*\brateLimit\b(?!\s*Result)[^}]*\}\s+from\s+["'][^"']*\/rate-limit["']/;
      if (valueImport.test(src) && !/import\s+type/.test(src.slice(0, src.indexOf("rate-limit")))) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      `These import the in-memory rateLimit() directly: ${offenders.join(", ")}. ` +
        "On Vercel that counts per serverless instance, so the limit is close " +
        "to no limit. Use rateLimitDurable from lib/rate-limit-store.ts.",
    ).toEqual([]);
  });

  it("the durable store still falls back to it", () => {
    // If this import ever goes, a database outage stops degrading protection
    // and starts removing it — or, worse, starts 429ing every real customer on
    // a client's contact form.
    const store = readFileSync(join(ROOT, "lib/rate-limit-store.ts"), "utf8");
    expect(store).toMatch(/rateLimit as rateLimitInMemory/);
    expect(store).toMatch(/degraded:\s*true/);
  });
});
