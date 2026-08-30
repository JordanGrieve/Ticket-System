import { describe, it, expect } from "vitest";
import {
  canRequeueFailed,
  describeRequeue,
  type RequeueCounts,
} from "../lib/campaign-requeue";
import type { CampaignStatus } from "../db/schema";

/**
 * Re-queueing a campaign that reached nobody.
 *
 * ── WHAT THESE PROTECT ──
 * One property, and it is the reason the feature is shaped this way: a
 * re-queue must be IMPOSSIBLE whenever anybody was reached. Claim-before-send
 * marks a row `sent` before the provider call, so a `failed` row sitting
 * beside delivered ones cannot be retried without risking a duplicate in
 * somebody's inbox. The precondition removes that rather than a dialog warning
 * about it.
 *
 * The case it exists for is the one docs/NEWSLETTER.md warns about: Open Door
 * Bakery has ONE confirmed subscriber, and a send attempted before SES
 * production access is granted fails wholesale and spends them.
 */

const counts = (over: Partial<RequeueCounts> = {}): RequeueCounts => ({
  queued: 0,
  reached: 0,
  failed: 1,
  ...over,
});

describe("the case it exists for", () => {
  it("allows a re-queue when every recipient failed", () => {
    const v = canRequeueFailed("sent", counts({ failed: 47 }));
    expect(v).toEqual({ ok: true, count: 47 });
  });

  it("allows it for a campaign marked failed as well as sent", () => {
    // An aborted send lands on `failed`; a wholly-rejected one is settled as
    // `sent` with zero delivered. Both are terminal and both are recoverable.
    expect(canRequeueFailed("failed", counts()).ok).toBe(true);
    expect(canRequeueFailed("sent", counts()).ok).toBe(true);
  });

  it("covers the one-subscriber case that motivated it", () => {
    const v = canRequeueFailed("sent", counts({ failed: 1 }));
    expect(v).toEqual({ ok: true, count: 1 });
    expect(describeRequeue(v)).toContain("Nobody received this");
  });
});

describe("it is impossible whenever anybody was reached", () => {
  /*
   * The safety property. Each of these is a row that was handed to the
   * provider, so a retry could put a second copy in a real inbox.
   */
  it("refuses when even one row reached the provider", () => {
    const v = canRequeueFailed("sent", counts({ reached: 1, failed: 46 }));
    expect(v).toEqual({ ok: false, reason: "partially_delivered" });
  });

  it("refuses at every scale of partial delivery", () => {
    for (const reached of [1, 2, 100, 39_999]) {
      expect(
        canRequeueFailed("sent", counts({ reached, failed: 1 })).ok,
        `reached=${reached} must refuse`,
      ).toBe(false);
    }
  });

  it("says WHY, because otherwise the button looks broken", () => {
    // Somebody who just watched most of a send fail will assume a refusal is a
    // bug unless it explains itself.
    const v = canRequeueFailed("sent", counts({ reached: 5 }));
    expect(describeRequeue(v)).toMatch(/duplicate/i);
    expect(describeRequeue(v)).toMatch(/new campaign/i);
  });
});

describe("it refuses anything that is not finished", () => {
  it("refuses every non-terminal status", () => {
    const statuses: CampaignStatus[] = ["draft", "scheduled", "sending"];
    for (const status of statuses) {
      expect(
        canRequeueFailed(status, counts()).ok,
        `${status} must refuse`,
      ).toBe(false);
    }
  });

  it("refuses a terminal campaign that still holds queued rows", () => {
    /*
     * Belt and braces. settleCampaign should leave none, so if one is here the
     * STATUS is the thing that is wrong — and re-queueing on top of rows the
     * sweep may still claim is how a duplicate happens by another route.
     */
    const v = canRequeueFailed("sent", counts({ queued: 3, failed: 2 }));
    expect(v).toEqual({ ok: false, reason: "not_finished" });
  });

  it("refuses when nothing failed", () => {
    const v = canRequeueFailed("sent", counts({ failed: 0 }));
    expect(v).toEqual({ ok: false, reason: "nothing_failed" });
  });
});

describe("every refusal is explained", () => {
  it("has wording for each reason", () => {
    for (const c of [
      counts({ queued: 1 }),
      counts({ reached: 1 }),
      counts({ failed: 0 }),
    ]) {
      const v = canRequeueFailed("sent", c);
      expect(v.ok).toBe(false);
      expect(describeRequeue(v).length).toBeGreaterThan(30);
    }
  });
});
