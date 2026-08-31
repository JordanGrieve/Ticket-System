import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forwardedIp } from "../lib/http";

/**
 * Rate limiting self-serve workspace creation.
 *
 * SELF-SERVE 6 names this as a prerequisite for flipping OPEN_SIGNUP, and what
 * it protects is specific: every workspace created this way gets an inbound
 * address on our domain and the ability to send mail on our sending
 * reputation. Invite-only is the only thing guarding that today.
 *
 * The IP helper is pure and tested directly. The placement — self-serve only,
 * never the admin invite path — is asserted against the source, the same way
 * tests/impersonation-invariants.test.ts works and for the same reason: this
 * suite runs with no DATABASE_URL and no Clerk.
 */

const src = readFileSync(join(process.cwd(), "lib", "workspace.ts"), "utf8");

/** Source with comments stripped, so prose cannot satisfy an assertion. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("forwardedIp", () => {
  const from = (h: Record<string, string>) =>
    forwardedIp((name) => h[name] ?? null);

  it("takes the leftmost X-Forwarded-For entry", () => {
    // The header is appended hop by hop, so the leftmost value is the original
    // client and everything after it is infrastructure. Taking the last one
    // would rate-limit our own edge.
    expect(from({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" }))
      .toBe("203.0.113.9");
  });

  it("falls back to X-Real-IP", () => {
    expect(from({ "x-real-ip": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("returns null when neither header is present", () => {
    // A real answer, not an error. The caller decides what to do about it.
    expect(from({})).toBeNull();
  });

  it("bounds attacker-supplied header content", () => {
    // 45 characters is the longest valid IPv6 text form. This is a length
    // bound on a value we do not parse, not a format check.
    const long = "a".repeat(500);
    expect(from({ "x-forwarded-for": long })?.length).toBe(45);
  });

  it("ignores an empty forwarded header rather than returning an empty string", () => {
    // "" as a bucket key would put every header-stripping proxy in the same
    // bucket as a genuine miss, by accident rather than by decision.
    expect(from({ "x-forwarded-for": "  ", "x-real-ip": "203.0.113.9" })).toBe(
      "203.0.113.9",
    );
  });
});

describe("the limit guards self-serve signup only", () => {
  it("rate-limits the OPEN_SIGNUP branch", () => {
    expect(code).toContain("rateLimitDurable(");
    expect(code).toMatch(/signup:ip:/);
  });

  it("sits AFTER the invite-claim path, so an invited client is never throttled", () => {
    /*
     * A client claiming the invite an operator prepared for them is not
     * creating anything — the workspace already exists. Counting that would
     * throttle the one path we most need to work on a client's first day.
     */
    const claim = code.indexOf("INVITE_PREFIX}%");
    const limit = code.indexOf("rateLimitDurable(");
    expect(claim).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(claim);
  });

  it("is NOT inside provisionWorkspace, which the admin flow also calls", () => {
    /*
     * THE PROPERTY MOST WORTH PINNING.
     *
     * provisionWorkspace serves both self-serve signup and the admin "add
     * client" flow. An operator setting up six clients in an afternoon is
     * doing their job; a limit that counted those would fire on the one caller
     * that must never be throttled.
     */
    const start = code.indexOf("export async function provisionWorkspace");
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf("\nexport ", start + 10));
    expect(body).not.toContain("rateLimitDurable(");
  });

  it("only runs when OPEN_SIGNUP is on", () => {
    // Invite-only returns before reaching it, so the limiter costs a closed
    // instance nothing — no query on a path that always refuses anyway.
    const gate = code.indexOf("if (!OPEN_SIGNUP) return null;");
    expect(gate).toBeGreaterThan(-1);
    expect(code.indexOf("rateLimitDurable(")).toBeGreaterThan(gate);
  });
});

describe("an unknown IP is not a free pass", () => {
  it("buckets a missing IP rather than skipping the limit", () => {
    /*
     * Skipping the check when the IP is unknown would make the control
     * removable by the attacker, who need only strip a header. Everything
     * without a forwarded IP shares one bucket instead — crude, worse for a
     * proxy's users, and correct for us.
     */
    expect(code).toMatch(/ip \?\? "unknown"/);
    // …and there is no early return that skips the limit on a null IP.
    const limit = code.indexOf("rateLimitDurable(");
    const before = code.slice(code.indexOf("if (!OPEN_SIGNUP)"), limit);
    expect(before).not.toMatch(/if \(!ip\)/);
  });
});
