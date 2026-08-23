import { describe, it, expect } from "vitest";
import {
  TRASH_RETENTION_DAYS,
  purgeDueAt,
  daysUntilPurge,
  isPurgeDue,
  describeRetention,
  describeDeletedBy,
} from "../lib/trash";

/**
 * Trash retention.
 *
 * This is the only path by which a customer's correspondence leaves the
 * database, so the arithmetic that decides "is this due?" is worth proving
 * rather than trusting — an off-by-one here destroys somebody's mail a day
 * early, and there is nothing to restore it from.
 */

const NOW = new Date("2026-09-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("when a deleted ticket becomes due", () => {
  it("is 30 days after deletion", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    const deleted = new Date("2026-08-24T12:00:00Z");
    expect(purgeDueAt(deleted).toISOString()).toBe("2026-09-23T12:00:00.000Z");
  });

  it("is NOT due one second early", () => {
    // The assertion that matters. A ticket destroyed before its 30 days is
    // data loss with no recovery, and the person who deleted it was told they
    // had a month.
    const deleted = new Date(NOW.getTime() - TRASH_RETENTION_DAYS * DAY + 1000);
    expect(isPurgeDue(deleted, NOW)).toBe(false);
  });

  it("is due exactly on the boundary", () => {
    const deleted = new Date(NOW.getTime() - TRASH_RETENTION_DAYS * DAY);
    expect(isPurgeDue(deleted, NOW)).toBe(true);
  });

  it("is due well past it", () => {
    const deleted = new Date(NOW.getTime() - 90 * DAY);
    expect(isPurgeDue(deleted, NOW)).toBe(true);
  });
});

describe("the countdown shown to the client", () => {
  it("counts whole days remaining", () => {
    const deleted = new Date(NOW.getTime() - 10 * DAY);
    expect(daysUntilPurge(deleted, NOW)).toBe(TRASH_RETENTION_DAYS - 10);
  });

  it("rounds part-days UP, so a live ticket never reads as 0 days", () => {
    // With eight hours left somebody has "1 day". Saying 0 while the ticket is
    // still restorable reads as a bug and provokes a panicked support email.
    const deleted = new Date(
      NOW.getTime() - (TRASH_RETENTION_DAYS * DAY - 8 * 60 * 60 * 1000),
    );
    expect(daysUntilPurge(deleted, NOW)).toBe(1);
  });

  it("floors at zero rather than going negative", () => {
    const deleted = new Date(NOW.getTime() - 60 * DAY);
    expect(daysUntilPurge(deleted, NOW)).toBe(0);
  });

  it("always names the deadline", () => {
    // A trash folder that does not say when things go is one people are afraid
    // to use and equally afraid to empty.
    for (const daysAgo of [0, 1, 15, 29, 30, 45]) {
      const text = describeRetention(new Date(NOW.getTime() - daysAgo * DAY), NOW);
      expect(text).toMatch(/permanently/);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it("reads naturally at the edges", () => {
    expect(describeRetention(new Date(NOW.getTime() - 29 * DAY), NOW)).toMatch(
      /tomorrow/,
    );
    expect(describeRetention(new Date(NOW.getTime() - 40 * DAY), NOW)).toMatch(
      /within the hour/,
    );
  });
});

describe("attribution", () => {
  it("uses the stored snapshot", () => {
    expect(describeDeletedBy("emma@bakery.com")).toBe("emma@bakery.com");
  });

  it("never renders an empty author as blank or undefined", () => {
    // "Deleted by undefined" is exactly the wrong answer to "who deleted our
    // customer's enquiry?".
    expect(describeDeletedBy(null)).toBe("someone on your team");
    expect(describeDeletedBy("   ")).toBe("someone on your team");
  });
});
