import { describe, it, expect } from "vitest";
import {
  isUnconfirmed,
  groupUnconfirmed,
  describeUnconfirmed,
  UNCONFIRMED_AFTER_MINUTES,
  UNCONFIRMED_ERROR,
  type UnconfirmedRow,
} from "../lib/campaign-reconcile";

/**
 * Rows claimed for sending whose outcome was never recorded.
 *
 * The assertions that matter here are about what this must NOT do. There is no
 * provider id to ask about, so the row cannot be resolved by querying anything
 * — and the wrong response to an unresolvable maybe is to re-send it.
 */

const NOW = new Date("2026-08-23T15:00:00Z");
const MIN = 60_000;

const row = (over: Partial<UnconfirmedRow> = {}): UnconfirmedRow => ({
  recipientId: 1,
  campaignId: 10,
  campaignName: "Autumn menu",
  workspaceId: 1,
  workspaceName: "Open Door Bakery",
  sentAt: new Date(NOW.getTime() - 90 * MIN),
  ...over,
});

describe("what counts as unconfirmed", () => {
  it("ignores a row claimed moments ago", () => {
    // A live batch is probably about to write the id. Annotating it would put
    // a frightening error on a perfectly good send.
    expect(isUnconfirmed({ sentAt: new Date(NOW.getTime() - MIN) }, NOW)).toBe(
      false,
    );
  });

  it("catches one older than the threshold", () => {
    const old = new Date(NOW.getTime() - (UNCONFIRMED_AFTER_MINUTES + 1) * MIN);
    expect(isUnconfirmed({ sentAt: old }, NOW)).toBe(true);
  });

  it("uses a threshold far longer than any provider call", () => {
    // A send plus the follow-up write is seconds. The gap exists so that
    // "still in flight" and "never finished" are never confused.
    expect(UNCONFIRMED_AFTER_MINUTES).toBeGreaterThanOrEqual(30);
  });
});

describe("grouping", () => {
  it("reports one entry per campaign, not one per recipient", () => {
    // Nine alerts saying "recipient 4471 has no confirmation" teach the reader
    // less in total than one saying nine recipients do.
    const groups = groupUnconfirmed([
      row({ recipientId: 1 }),
      row({ recipientId: 2 }),
      row({ recipientId: 3 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it("keeps the oldest claim as the group's timestamp", () => {
    const groups = groupUnconfirmed([
      row({ recipientId: 1, sentAt: new Date(NOW.getTime() - 90 * MIN) }),
      row({ recipientId: 2, sentAt: new Date(NOW.getTime() - 300 * MIN) }),
    ]);
    // It is what somebody searches the provider's logs around.
    expect(groups[0].oldestSentAt.toISOString()).toBe(
      new Date(NOW.getTime() - 300 * MIN).toISOString(),
    );
  });

  it("separates campaigns and puts the worst first", () => {
    const groups = groupUnconfirmed([
      row({ campaignId: 10, campaignName: "Small" }),
      row({ campaignId: 20, campaignName: "Big", recipientId: 2 }),
      row({ campaignId: 20, campaignName: "Big", recipientId: 3 }),
      row({ campaignId: 20, campaignName: "Big", recipientId: 4 }),
    ]);
    expect(groups.map((g) => g.campaignName)).toEqual(["Big", "Small"]);
  });

  it("handles an empty list", () => {
    expect(groupUnconfirmed([])).toEqual([]);
  });
});

describe("what the operator is told", () => {
  const [group] = groupUnconfirmed([row(), row({ recipientId: 2 })]);

  it("says the evidence is missing, not that the send failed", () => {
    const text = describeUnconfirmed(group);
    expect(text).toMatch(/no evidence/i);
    // "failed" would assert the provider refused, which is exactly what is
    // not known.
    expect(text).not.toMatch(/\bfailed\b/i);
  });

  it("says explicitly that they are NOT re-sent, and why", () => {
    // Without this the first instinct on reading the alert is to go and
    // re-send manually — the one action the whole design avoids.
    const text = describeUnconfirmed(group);
    expect(text).toMatch(/not re-sent/i);
    expect(text).toMatch(/duplicate/i);
  });

  it("points at the provider's own logs, with a time to look around", () => {
    const text = describeUnconfirmed(group);
    expect(text).toContain(group.oldestSentAt.toISOString());
  });

  it("names the campaign and counts the people", () => {
    expect(describeUnconfirmed(group)).toContain("Autumn menu");
    expect(describeUnconfirmed(group)).toContain("2 recipients");
  });

  it("says 'recipient' for one", () => {
    const [one] = groupUnconfirmed([row()]);
    expect(describeUnconfirmed(one)).toContain("1 recipient ");
  });
});

describe("the error stamped on the row", () => {
  it("explains itself without needing this file to be read", () => {
    // Somebody finds this string in a database six months from now with no
    // context. It has to carry its own explanation.
    expect(UNCONFIRMED_ERROR).toMatch(/no delivery confirmation/i);
    expect(UNCONFIRMED_ERROR).toMatch(/do not re-send/i);
    expect(UNCONFIRMED_ERROR.length).toBeGreaterThan(60);
  });
});
