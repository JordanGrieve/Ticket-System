import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SNOOZE_OPTIONS,
  MAX_SNOOZE_MINUTES,
  isValidSnoozeMinutes,
  isSnoozedNow,
  describeWakeIn,
} from "../lib/snooze";

/**
 * Snooze.
 *
 * The property that matters most is not in this file's functions at all: a
 * snoozed ticket must come back on its own. That is enforced by deriving the
 * state from `snoozed_until > now()` rather than storing a flag, and the last
 * describe below reads the source to check nobody has quietly added the
 * scheduler that design exists to avoid.
 */

const NOW = new Date("2026-08-23T12:00:00Z");
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow);

describe("what counts as snoozed", () => {
  it("a null wake time is not snoozed", () => {
    // Every ticket ever created has NULL here. If this returned true the
    // entire inbox would be hidden.
    expect(isSnoozedNow(null, NOW)).toBe(false);
  });

  it("a future wake time is snoozed", () => {
    expect(isSnoozedNow(at(60_000), NOW)).toBe(true);
  });

  it("a past wake time is NOT snoozed", () => {
    // This is the whole design: the ticket wakes because time passed, not
    // because something ran.
    expect(isSnoozedNow(at(-1), NOW)).toBe(false);
  });

  it("wakes exactly on the boundary, not after it", () => {
    // Matches the SQL, which is `snoozed_until > now()` — strictly greater. At
    // the instant it is due, it is awake. If the two disagreed by one
    // comparison the list and the ticket page would contradict each other for
    // a second, which is exactly the kind of thing nobody can reproduce.
    expect(isSnoozedNow(at(0), NOW)).toBe(false);
    expect(isSnoozedNow(at(1), NOW)).toBe(true);
  });
});

describe("durations the API will accept", () => {
  it("accepts every duration the UI offers", () => {
    // If an option is unusable the button is a lie.
    for (const o of SNOOZE_OPTIONS) {
      expect(isValidSnoozeMinutes(o.minutes), o.label).toBe(true);
    }
  });

  it("rejects zero and negative", () => {
    // A wake time in the past is a ticket that never hides — the button
    // appears to do nothing, which reads as broken rather than refused.
    expect(isValidSnoozeMinutes(0)).toBe(false);
    expect(isValidSnoozeMinutes(-60)).toBe(false);
  });

  it("rejects nonsense a form post can produce", () => {
    expect(isValidSnoozeMinutes(NaN)).toBe(false);
    expect(isValidSnoozeMinutes(Infinity)).toBe(false);
    expect(isValidSnoozeMinutes(1.5)).toBe(false);
  });

  it("caps the maximum", () => {
    // A ten-year snooze is deleting the ticket without the 30-day safety net
    // or the audit trail a delete carries.
    expect(isValidSnoozeMinutes(MAX_SNOOZE_MINUTES)).toBe(true);
    expect(isValidSnoozeMinutes(MAX_SNOOZE_MINUTES + 1)).toBe(false);
  });
});

describe("what the screen says", () => {
  it("says nothing for a ticket that is not snoozed", () => {
    expect(describeWakeIn(null, NOW)).toBeNull();
  });

  it("says nothing once the time has passed", () => {
    // A woken ticket is an ordinary ticket. A banner explaining a state it is
    // no longer in is noise on the screen of somebody reading their mail.
    expect(describeWakeIn(at(-1000), NOW)).toBeNull();
  });

  it("never says zero of something that has not happened", () => {
    // 40 minutes rounds UP to "in 1 hour". "in 0 hours" reads as a bug.
    expect(describeWakeIn(at(40 * 60_000), NOW)).toBe("in 40 min");
    expect(describeWakeIn(at(59 * 60_000), NOW)).toBe("in 59 min");
    expect(describeWakeIn(at(90 * 60_000), NOW)).toBe("in 2 hours");
    // 30 seconds rounds up to a whole minute rather than reporting zero.
    expect(describeWakeIn(at(30_000), NOW)).toBe("in 1 min");
  });

  it("singularises", () => {
    expect(describeWakeIn(at(60 * 60_000), NOW)).toBe("in 1 hour");
    expect(describeWakeIn(at(24 * 60 * 60_000), NOW)).toBe("in 1 day");
  });
});

describe("there is still no un-snooze scheduler", () => {
  /*
   * The board scoped snooze as needing a cron job. It does not, because the
   * state is derived. This guards that decision from being quietly reversed:
   * adding a job would introduce a moving part that can be down, late, or run
   * twice, and whose only observable effect would be to reproduce what the SQL
   * predicate already says. Every minute it was broken, tickets would stay
   * hidden past their time and nobody would know why.
   */
  const store = readFileSync(
    join(process.cwd(), "lib/snooze-store.ts"),
    "utf8",
  );

  it("the store never bulk-clears snoozed_until", () => {
    // A sweep would look like an update with no ticket id — clearing by time
    // across the table. unsnoozeTicket is per-ticket and per-workspace.
    expect(store).toMatch(/eq\(tickets\.id, input\.ticketId\)/);
    expect(store).not.toMatch(/snoozedUntil.*<=.*now\(\)/);
  });

  it("the workflow directory has no un-snooze job", () => {
    const workflows = readFileSync(
      join(process.cwd(), ".github/workflows/campaign-sweep.yml"),
      "utf8",
    );
    expect(workflows.toLowerCase()).not.toContain("snooze");
  });

  it("the wake time is computed by Postgres, not by JS", () => {
    // Setting the deadline from a serverless instance's clock and then testing
    // it against the database's is how snooze comes back an hour early —
    // which nobody reports as a bug, they just stop trusting it.
    expect(store).toMatch(/make_interval/);
    expect(store).not.toMatch(/new Date\(Date\.now\(\) \+/);
  });
});
