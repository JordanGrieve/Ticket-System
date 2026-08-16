import { describe, it, expect } from "vitest";
import {
  describeBusinessHours,
  evaluateSchedule,
  isValidBusinessHours,
  isValidTimeZone,
  isWithinBusinessHours,
  parseHHMM,
  zonedParts,
} from "../lib/business-hours";
import type { BusinessHours } from "../db/schema";

/** Mon–Fri 09:00–17:30. */
const WEEKDAYS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:30",
};

describe("parseHHMM", () => {
  it("parses valid times to minutes since midnight", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("09:30")).toBe(570);
    expect(parseHHMM("23:59")).toBe(1439);
    expect(parseHHMM(" 9:05 ")).toBe(545);
  });

  it("rejects nonsense", () => {
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("09:60")).toBeNull();
    expect(parseHHMM("nine")).toBeNull();
    expect(parseHHMM("")).toBeNull();
  });
});

describe("timezone handling", () => {
  it("recognises real IANA zones and rejects typos", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Europe/Lundon")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("reads wall-clock parts in the target zone, not the host's", () => {
    // 2025-07-15T12:00:00Z — a Tuesday.
    const instant = new Date("2025-07-15T12:00:00Z");
    expect(zonedParts(instant, "UTC")).toMatchObject({
      weekday: 2,
      hour: 12,
      minute: 0,
    });
    // BST in July: UTC+1.
    expect(zonedParts(instant, "Europe/London")).toMatchObject({
      weekday: 2,
      hour: 13,
    });
    // Half-hour offset zone.
    expect(zonedParts(instant, "Asia/Kolkata")).toMatchObject({
      weekday: 2,
      hour: 17,
      minute: 30,
    });
    // Behind UTC far enough to still be Tuesday morning.
    expect(zonedParts(instant, "America/Los_Angeles")).toMatchObject({
      weekday: 2,
      hour: 5,
    });
  });

  it("falls back to UTC for an unknown zone rather than the host clock", () => {
    const instant = new Date("2025-07-15T12:00:00Z");
    expect(zonedParts(instant, "Not/AZone")).toEqual(
      zonedParts(instant, "UTC"),
    );
  });

  it("reports midnight as hour 0, never 24", () => {
    const midnight = new Date("2025-03-04T00:00:00Z");
    expect(zonedParts(midnight, "UTC").hour).toBe(0);
    expect(zonedParts(midnight, "UTC").minutesOfDay).toBe(0);
  });
});

describe("isWithinBusinessHours — timezone boundaries", () => {
  it("uses the workspace zone, so the same instant differs per zone", () => {
    // Tue 2025-07-15 08:30 UTC = 09:30 London (open) but 01:30 Los Angeles.
    const instant = new Date("2025-07-15T08:30:00Z");
    expect(isWithinBusinessHours(instant, WEEKDAYS, "Europe/London")).toBe(true);
    expect(isWithinBusinessHours(instant, WEEKDAYS, "UTC")).toBe(false);
    expect(
      isWithinBusinessHours(instant, WEEKDAYS, "America/Los_Angeles"),
    ).toBe(false);
  });

  it("tracks daylight saving instead of a fixed offset", () => {
    // 08:30Z is 09:30 in London during BST (open) …
    expect(
      isWithinBusinessHours(
        new Date("2025-07-15T08:30:00Z"),
        WEEKDAYS,
        "Europe/London",
      ),
    ).toBe(true);
    // … and 08:30 in London during GMT (closed). Same UTC instant, same
    // config — this is the case naive offset maths gets wrong twice a year.
    expect(
      isWithinBusinessHours(
        new Date("2025-01-14T08:30:00Z"),
        WEEKDAYS,
        "Europe/London",
      ),
    ).toBe(false);
  });

  it("is half-open: start is inside, end is not", () => {
    const tz = "UTC";
    expect(
      isWithinBusinessHours(new Date("2025-07-15T09:00:00Z"), WEEKDAYS, tz),
    ).toBe(true);
    expect(
      isWithinBusinessHours(new Date("2025-07-15T08:59:00Z"), WEEKDAYS, tz),
    ).toBe(false);
    expect(
      isWithinBusinessHours(new Date("2025-07-15T17:29:00Z"), WEEKDAYS, tz),
    ).toBe(true);
    expect(
      isWithinBusinessHours(new Date("2025-07-15T17:30:00Z"), WEEKDAYS, tz),
    ).toBe(false);
  });

  it("respects the day list", () => {
    // 2025-07-19 is a Saturday.
    expect(
      isWithinBusinessHours(new Date("2025-07-19T12:00:00Z"), WEEKDAYS, "UTC"),
    ).toBe(false);
    const withSaturday: BusinessHours = { ...WEEKDAYS, days: [6] };
    expect(
      isWithinBusinessHours(new Date("2025-07-19T12:00:00Z"), withSaturday, "UTC"),
    ).toBe(true);
  });

  it("handles a window that wraps midnight, crediting the opening day", () => {
    // Friday night shift: 22:00 Fri → 06:00 Sat.
    const overnight: BusinessHours = { days: [5], start: "22:00", end: "06:00" };
    // Fri 2025-07-18 23:00 UTC — inside, on the opening day.
    expect(
      isWithinBusinessHours(new Date("2025-07-18T23:00:00Z"), overnight, "UTC"),
    ).toBe(true);
    // Sat 2025-07-19 02:00 UTC — still inside, credited to Friday.
    expect(
      isWithinBusinessHours(new Date("2025-07-19T02:00:00Z"), overnight, "UTC"),
    ).toBe(true);
    // Sat 06:00 — the window has closed.
    expect(
      isWithinBusinessHours(new Date("2025-07-19T06:00:00Z"), overnight, "UTC"),
    ).toBe(false);
    // Sat 23:00 — Saturday is not an opening day.
    expect(
      isWithinBusinessHours(new Date("2025-07-19T23:00:00Z"), overnight, "UTC"),
    ).toBe(false);
  });

  it("crosses midnight correctly when the zone shifts the calendar day", () => {
    // Mon 2025-07-14 23:30 UTC is already Tue 09:00 in Tokyo — open.
    expect(
      isWithinBusinessHours(new Date("2025-07-14T23:59:00Z"), WEEKDAYS, "UTC"),
    ).toBe(false);
    expect(
      isWithinBusinessHours(new Date("2025-07-15T00:00:00Z"), WEEKDAYS, "Asia/Tokyo"),
    ).toBe(true); // Tue 09:00 JST
    // Mon 2025-07-21 00:30 UTC = Mon 09:30 Tokyo → open there, while the same
    // instant is the small hours of Monday in UTC and firmly shut.
    expect(
      isWithinBusinessHours(new Date("2025-07-21T00:30:00Z"), WEEKDAYS, "Asia/Tokyo"),
    ).toBe(true);
    expect(
      isWithinBusinessHours(new Date("2025-07-21T00:30:00Z"), WEEKDAYS, "UTC"),
    ).toBe(false);
    // Sun 2025-07-20 23:30 UTC is Mon 08:30 in Tokyo — a workday, but before
    // opening time.
    expect(
      isWithinBusinessHours(new Date("2025-07-20T23:30:00Z"), WEEKDAYS, "Asia/Tokyo"),
    ).toBe(false);
  });

  it("is never 'inside' a missing or malformed window", () => {
    const now = new Date("2025-07-15T12:00:00Z");
    expect(isWithinBusinessHours(now, null, "UTC")).toBe(false);
    expect(isWithinBusinessHours(now, undefined, "UTC")).toBe(false);
    expect(
      isWithinBusinessHours(now, { days: [], start: "09:00", end: "17:00" }, "UTC"),
    ).toBe(false);
    expect(
      isWithinBusinessHours(now, { days: [2], start: "bad", end: "17:00" }, "UTC"),
    ).toBe(false);
    // Zero-length window: open never.
    expect(
      isWithinBusinessHours(now, { days: [2], start: "09:00", end: "09:00" }, "UTC"),
    ).toBe(false);
  });
});

describe("evaluateSchedule", () => {
  const openInstant = new Date("2025-07-15T12:00:00Z"); // Tue 12:00 UTC
  const shutInstant = new Date("2025-07-15T22:00:00Z"); // Tue 22:00 UTC

  it("always sends in `always` mode, whatever the clock says", () => {
    expect(evaluateSchedule("always", shutInstant, WEEKDAYS, "UTC")).toMatchObject(
      { allowed: true, inHours: false },
    );
    expect(evaluateSchedule("always", openInstant, WEEKDAYS, "UTC")).toMatchObject(
      { allowed: true, inHours: true },
    );
  });

  it("gates on the window in `business_hours` mode", () => {
    expect(
      evaluateSchedule("business_hours", openInstant, WEEKDAYS, "UTC").allowed,
    ).toBe(true);
    expect(
      evaluateSchedule("business_hours", shutInstant, WEEKDAYS, "UTC").allowed,
    ).toBe(false);
  });

  it("inverts the window in `out_of_hours` mode", () => {
    expect(
      evaluateSchedule("out_of_hours", openInstant, WEEKDAYS, "UTC").allowed,
    ).toBe(false);
    expect(
      evaluateSchedule("out_of_hours", shutInstant, WEEKDAYS, "UTC").allowed,
    ).toBe(true);
  });

  it("refuses to send in `business_hours` mode with no window configured", () => {
    // Failing closed matters: the alternative is blasting acknowledgements
    // 24/7 from a half-finished configuration.
    expect(evaluateSchedule("business_hours", openInstant, null, "UTC")).toMatchObject(
      { allowed: false, reason: "no_window_configured" },
    );
    // Every moment is outside a window that does not exist.
    expect(evaluateSchedule("out_of_hours", openInstant, null, "UTC").allowed).toBe(
      true,
    );
  });
});

describe("validation and description helpers", () => {
  it("validates stored windows", () => {
    expect(isValidBusinessHours(WEEKDAYS)).toBe(true);
    expect(isValidBusinessHours(null)).toBe(true);
    expect(isValidBusinessHours({ days: [7], start: "09:00", end: "17:00" })).toBe(
      false,
    );
    expect(isValidBusinessHours({ days: [1], start: "09:00", end: "09:00" })).toBe(
      false,
    );
    expect(isValidBusinessHours({ days: [1], start: "9am", end: "5pm" })).toBe(
      false,
    );
  });

  it("summarises a window for the settings screen", () => {
    expect(describeBusinessHours(WEEKDAYS, "Europe/London")).toBe(
      "Mon, Tue, Wed, Thu, Fri · 09:00–17:30 (Europe/London)",
    );
    expect(describeBusinessHours(null, "UTC")).toBe("No hours set");
  });
});
