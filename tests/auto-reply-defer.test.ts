import { describe, it, expect } from "vitest";
import {
  DEFERRAL_HORIZON_DAYS,
  nextBusinessHoursOpening,
  planDeferral,
  type AutoReplyConfig,
} from "../lib/auto-reply";
import { isWithinBusinessHours, zonedParts } from "../lib/business-hours";
import type { BusinessHours } from "../db/schema";

/**
 * Deferring an out-of-hours acknowledgement instead of dropping it.
 *
 * The bug these cover: an enquiry arriving at 21:00 against a "business hours
 * only" schedule was suppressed and never revisited, so the acknowledgement
 * the workspace had configured simply never happened. The queue now holds it
 * until the next opening minute — and the two properties that matter about
 * that minute are asserted here rather than reasoned about:
 *
 *   1. it really is the FIRST minute the workspace is open (the minute before
 *      it is still closed), and
 *   2. it agrees with `isWithinBusinessHours`, the evaluator the send path
 *      uses, across DST and midnight-wrapping windows.
 *
 * Pure throughout: no database, no mail provider.
 */

const OFFICE: BusinessHours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
const LONDON = "Europe/London";

/** Assert `at` is the first open minute: open then, closed a minute earlier. */
function expectFirstOpenMinute(
  at: Date,
  hours: BusinessHours,
  zone: string,
): void {
  expect(isWithinBusinessHours(at, hours, zone)).toBe(true);
  const minuteBefore = new Date(at.getTime() - 60_000);
  expect(isWithinBusinessHours(minuteBefore, hours, zone)).toBe(false);
}

describe("nextBusinessHoursOpening", () => {
  it("holds a Friday-night enquiry until Monday morning", () => {
    // Friday 2026-08-21, 21:00 London (BST, so 20:00Z).
    const friday = new Date("2026-08-21T20:00:00Z");
    const openAt = nextBusinessHoursOpening(friday, OFFICE, LONDON);

    expect(openAt).not.toBeNull();
    const parts = zonedParts(openAt!, LONDON);
    expect(parts.weekday).toBe(1); // Monday
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(0);
    expectFirstOpenMinute(openAt!, OFFICE, LONDON);
  });

  it("holds an evening enquiry until the next morning, not a week", () => {
    // Tuesday 2026-08-18, 21:30 London.
    const tuesdayNight = new Date("2026-08-18T20:30:00Z");
    const openAt = nextBusinessHoursOpening(tuesdayNight, OFFICE, LONDON);

    const parts = zonedParts(openAt!, LONDON);
    expect(parts.weekday).toBe(3); // Wednesday
    expect(parts.hour).toBe(9);
    // Under twelve hours away — a whole week would also satisfy "is open".
    expect(openAt!.getTime() - tuesdayNight.getTime()).toBeLessThan(
      13 * 60 * 60 * 1000,
    );
  });

  it("holds a pre-opening enquiry until later the same morning", () => {
    // Wednesday 2026-08-19, 06:40 London.
    const earlyBird = new Date("2026-08-19T05:40:00Z");
    const openAt = nextBusinessHoursOpening(earlyBird, OFFICE, LONDON);

    const parts = zonedParts(openAt!, LONDON);
    expect(parts.weekday).toBe(3);
    expect(parts.hour).toBe(9);
    expect(openAt!.getTime() - earlyBird.getTime()).toBeLessThan(
      4 * 60 * 60 * 1000,
    );
  });

  it("returns null while the workspace is already open — nothing to hold", () => {
    // Wednesday 2026-08-19, 11:00 London.
    expect(
      nextBusinessHoursOpening(new Date("2026-08-19T10:00:00Z"), OFFICE, LONDON),
    ).toBeNull();
  });

  it("returns null when there is no window to wait for", () => {
    const now = new Date("2026-08-21T20:00:00Z");
    expect(nextBusinessHoursOpening(now, null, LONDON)).toBeNull();
    expect(
      nextBusinessHoursOpening(now, { ...OFFICE, days: [] }, LONDON),
    ).toBeNull();
    // Zero-length window: never open, so never a next opening.
    expect(
      nextBusinessHoursOpening(
        now,
        { days: [1], start: "09:00", end: "09:00" },
        LONDON,
      ),
    ).toBeNull();
  });

  it("crosses a DST transition without drifting an hour", () => {
    // The UK clocks go forward at 01:00 on Sunday 2026-03-29. An enquiry on
    // the Saturday evening must be held until 09:00 BST on the Monday — which
    // is 08:00Z, NOT the 09:00Z that adding hours to a Date would produce.
    const beforeTheChange = new Date("2026-03-28T20:00:00Z");
    const openAt = nextBusinessHoursOpening(beforeTheChange, OFFICE, LONDON);

    expect(openAt!.toISOString()).toBe("2026-03-30T08:00:00.000Z");
    const parts = zonedParts(openAt!, LONDON);
    expect(parts.hour).toBe(9);
    expectFirstOpenMinute(openAt!, OFFICE, LONDON);
  });

  it("handles a half-hour zone", () => {
    // Friday 2026-08-21, 22:00 in Kolkata (UTC+05:30) → Monday 09:00 there.
    const kolkata = "Asia/Kolkata";
    const fridayNight = new Date("2026-08-21T16:30:00Z");
    const openAt = nextBusinessHoursOpening(fridayNight, OFFICE, kolkata);

    const parts = zonedParts(openAt!, kolkata);
    expect(parts.weekday).toBe(1);
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(0);
    expectFirstOpenMinute(openAt!, OFFICE, kolkata);
  });

  it("handles a window that wraps midnight", () => {
    // Night shift: opens 22:00 on Fri and Sat, closes 06:00 the next morning.
    const nightShift: BusinessHours = {
      days: [5, 6],
      start: "22:00",
      end: "06:00",
    };
    // Friday 2026-08-21, 12:00 London — closed, opens at 22:00 that night.
    const fridayNoon = new Date("2026-08-21T11:00:00Z");
    const openAt = nextBusinessHoursOpening(fridayNoon, nightShift, LONDON);

    const parts = zonedParts(openAt!, LONDON);
    expect(parts.weekday).toBe(5);
    expect(parts.hour).toBe(22);
    expect(parts.minute).toBe(0);
    expectFirstOpenMinute(openAt!, nightShift, LONDON);
  });

  it("finds a once-a-week window from any point in the week", () => {
    // Open Wednesdays only. Every start point in the following week must find
    // it, which is what the horizon being longer than seven days buys.
    const wednesdays: BusinessHours = {
      days: [3],
      start: "09:00",
      end: "17:00",
    };
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const from = new Date(
        Date.parse("2026-08-19T18:00:00Z") + dayOffset * 24 * 60 * 60 * 1000,
      );
      const openAt = nextBusinessHoursOpening(from, wednesdays, LONDON);
      expect(openAt).not.toBeNull();
      expect(zonedParts(openAt!, LONDON).weekday).toBe(3);
      expect(openAt!.getTime()).toBeGreaterThan(from.getTime());
      expect(openAt!.getTime() - from.getTime()).toBeLessThanOrEqual(
        DEFERRAL_HORIZON_DAYS * 24 * 60 * 60 * 1000,
      );
    }
  });
});

// ── Which schedules defer ────────────────────────────────────────

function config(over: Partial<AutoReplyConfig> = {}): AutoReplyConfig {
  return {
    enabled: true,
    subject: "s",
    body: "b",
    outOfHoursBody: null,
    delay: "immediate",
    scheduleMode: "business_hours",
    businessHours: OFFICE,
    timezone: LONDON,
    skipIfTeammateReplied: true,
    ...over,
  };
}

describe("planDeferral", () => {
  const fridayNight = new Date("2026-08-21T20:00:00Z");
  const wednesdayMidday = new Date("2026-08-19T10:00:00Z");

  it("holds an out-of-hours enquiry on the business-hours schedule", () => {
    const dueAt = planDeferral(config(), fridayNight);
    expect(dueAt).not.toBeNull();
    expect(zonedParts(dueAt!, LONDON).weekday).toBe(1);
  });

  it("does not hold anything on the out-of-hours schedule", () => {
    // Suppression there happens while the workspace is OPEN. Holding a
    // "we're closed" message until closing time would deliver it hours after
    // a human has already answered.
    expect(
      planDeferral(config({ scheduleMode: "out_of_hours" }), wednesdayMidday),
    ).toBeNull();
    expect(
      planDeferral(config({ scheduleMode: "out_of_hours" }), fridayNight),
    ).toBeNull();
  });

  it("does not hold anything on the always schedule", () => {
    // "always" never suppresses on schedule, so there is nothing to hold.
    expect(planDeferral(config({ scheduleMode: "always" }), fridayNight)).toBeNull();
  });

  it("cannot hold anything when no window is configured", () => {
    // This is the case the settings screen must call a DROP rather than a
    // deferral: there is no next opening to wait for.
    expect(planDeferral(config({ businessHours: null }), fridayNight)).toBeNull();
    expect(
      planDeferral(config({ businessHours: { ...OFFICE, days: [] } }), fridayNight),
    ).toBeNull();
  });
});
