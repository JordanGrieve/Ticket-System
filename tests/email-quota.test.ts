import { describe, it, expect } from "vitest";
import {
  PROVIDER_DAILY_CAP,
  WARN_AT,
  providerDayBucket,
  quotaState,
  isProviderRateLimit,
} from "../lib/email-quota";

/**
 * The daily ceiling on the shared transactional account.
 *
 * Resend's free plan is 3,000 a month capped at 100 a DAY, and every tenant's
 * ticket acknowledgements, auto-replies, welcome emails and confirmations go
 * through it. PRICING.md, before any of this existed: "the daily cap breaks
 * first, and it breaks silently for the client."
 *
 * These are the rules that decide whether the health check says anything.
 */

describe("the day bucket", () => {
  it("is one bucket per UTC calendar day", () => {
    const morning = new Date("2026-09-11T00:14:00Z");
    const night = new Date("2026-09-11T23:59:59Z");
    expect(providerDayBucket(morning)).toBe(providerDayBucket(night));
    expect(providerDayBucket(new Date("2026-09-12T00:00:00Z"))).not.toBe(
      providerDayBucket(morning),
    );
  });

  it("uses UTC, not the machine's zone", () => {
    // 23:30 in London on 11 Sep is 22:30 UTC — still the 11th either way.
    // The one that matters is just after midnight UTC, which is the previous
    // evening in New York: it must roll, because the provider's day has.
    expect(providerDayBucket(new Date("2026-09-12T00:30:00Z"))).toContain("2026-09-12");
    expect(providerDayBucket(new Date("2026-09-11T23:30:00Z"))).toContain("2026-09-11");
  });

  it("pads the month and day, so buckets sort and read correctly", () => {
    expect(providerDayBucket(new Date("2026-01-05T12:00:00Z"))).toBe(
      "email:provider:2026-01-05",
    );
  });
});

describe("how close to the cap", () => {
  it("is quiet well below the line", () => {
    const q = quotaState(10);
    expect(q.used).toBe(10);
    expect(q.remaining).toBe(PROVIDER_DAILY_CAP - 10);
    expect(q.warn).toBe(false);
    expect(q.exhausted).toBe(false);
  });

  it("warns once four fifths of the cap is gone, and not before", () => {
    /*
     * The 0.8 here is a LITERAL, not WARN_AT.
     *
     * The first version of this computed its inputs from WARN_AT itself, so
     * it passed for any threshold at all — setting WARN_AT to 1 left it
     * green. A test that derives its expectation from the thing it is testing
     * cannot fail, which is worse than not having written it.
     */
    const fourFifths = Math.ceil(PROVIDER_DAILY_CAP * 0.8);
    expect(quotaState(fourFifths - 1).warn).toBe(false);
    expect(quotaState(fourFifths).warn).toBe(true);
    // And the constant still says what the rule says, so the two cannot drift
    // apart silently.
    expect(WARN_AT).toBe(0.8);
  });

  it("reports exhausted at the cap", () => {
    const q = quotaState(PROVIDER_DAILY_CAP);
    expect(q.exhausted).toBe(true);
    expect(q.remaining).toBe(0);
  });

  it("clamps past the cap rather than going negative", () => {
    // Reachable: the provider allows a burst, or a send lands between the
    // read and the count. A negative "remaining" on an operator's screen is
    // a bug report, not information.
    const q = quotaState(PROVIDER_DAILY_CAP + 25);
    expect(q.remaining).toBe(0);
    expect(q.exhausted).toBe(true);
    expect(q.used).toBe(PROVIDER_DAILY_CAP + 25);
  });

  it("warns immediately on a cap of zero rather than dividing by it", () => {
    const q = quotaState(0, 0);
    expect(q.warn).toBe(true);
    expect(q.exhausted).toBe(true);
  });
});

describe("telling a rate limit from a bad address", () => {
  it("recognises a 429 whatever it says", () => {
    expect(isProviderRateLimit({ statusCode: 429, name: "anything" })).toBe(true);
  });

  it("recognises the wording when there is no status code", () => {
    expect(isProviderRateLimit({ name: "rate_limit_exceeded" })).toBe(true);
    expect(isProviderRateLimit({ message: "Too many requests" })).toBe(true);
    expect(isProviderRateLimit({ message: "Daily quota exceeded" })).toBe(true);
  });

  it("does NOT claim a rejected address is a rate limit", () => {
    // The false positive is the expensive one: it would tell an operator the
    // whole platform is capped when one customer typed their email wrong.
    expect(isProviderRateLimit({ statusCode: 422, name: "validation_error" })).toBe(false);
    expect(isProviderRateLimit({ message: "Invalid `to` field" })).toBe(false);
    expect(isProviderRateLimit({ statusCode: 403, name: "not_authorized" })).toBe(false);
  });

  it("survives the provider's nulls", () => {
    // Resend types statusCode as `number | null`; a narrower signature here
    // would push a cast onto every call site.
    expect(isProviderRateLimit({ statusCode: null, name: null, message: null })).toBe(false);
    expect(isProviderRateLimit({})).toBe(false);
  });
});
