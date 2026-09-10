import { describe, it, expect } from "vitest";
import {
  readinessSteps,
  readyToSend,
  describeWhen,
  primaryLabel,
  scheduledSummary,
} from "../lib/campaign-readiness";

/**
 * The schedule card's checklist and readout, as pure functions.
 *
 * The composer draws exactly what these return, so a wrong tick or a wrong
 * label here IS the bug on screen — which is why they live in lib and not in
 * the component.
 */

const allDone = {
  saved: true,
  dirty: false,
  listChosen: true,
  audienceCount: 240,
  queued: 240,
  placeholders: 0,
  postalAddress: true,
};

describe("the readiness checklist", () => {
  it("ticks every step when everything is in place", () => {
    const steps = readinessSteps(allDone);
    expect(steps.map((s) => s.done)).toEqual([true, true, true, true, true]);
    expect(steps.map((s) => s.label)).toEqual([
      "Draft saved",
      "Audience chosen (240 people)",
      "Recipients queued (240)",
      "No placeholders left in the body",
      "Postal address on file",
    ]);
    expect(readyToSend(steps, "draft")).toBe(true);
  });

  it("an unsaved draft has nothing ticked, and says so", () => {
    const steps = readinessSteps({
      saved: false,
      dirty: true,
      listChosen: false,
      audienceCount: null,
      queued: 0,
      placeholders: 2,
      postalAddress: false,
    });
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false, false]);
    expect(steps[0]!.label).toBe("Draft saved");
    expect(steps[3]!.label).toBe("2 placeholders still in the body");
    expect(steps[4]!.label).toBe("Postal address missing");
    expect(readyToSend(steps, "draft")).toBe(false);
  });

  it("unsaved edits un-tick the save step — sending uses what the server holds", () => {
    const steps = readinessSteps({ ...allDone, dirty: true });
    expect(steps[0]).toMatchObject({ done: false, label: "Unsaved changes" });
    expect(readyToSend(steps, "draft")).toBe(false);
  });

  it("a list chosen but not yet counted does not invent a number", () => {
    const steps = readinessSteps({ ...allDone, audienceCount: null });
    expect(steps[1]!.label).toBe("Audience chosen");
    expect(steps[1]!.done).toBe(true);
  });

  it("one placeholder is singular", () => {
    expect(readinessSteps({ ...allDone, placeholders: 1 })[3]!.label).toBe(
      "1 placeholder still in the body",
    );
  });

  it("a finished campaign is never ready, however complete the list", () => {
    const steps = readinessSteps(allDone);
    expect(readyToSend(steps, "sent")).toBe(false);
    expect(readyToSend(steps, "sending")).toBe(false);
    // Re-scheduling an armed campaign is allowed (lib/campaign-schedule.ts).
    expect(readyToSend(steps, "scheduled")).toBe(true);
  });
});

describe("saying the chosen time back", () => {
  const now = new Date("2026-09-10T09:00:00Z");
  const tz = "Europe/London";

  it("reads a date and a time as words, with how far away it is", () => {
    const r = describeWhen("2026-09-12", "10:00", now, tz);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.text).toBe("Sat 12 Sept, 10:00 · in 2 days · Europe/London");
    expect(new Date(r.iso).getTime()).toBe(new Date("2026-09-12T10:00").getTime());
  });

  it("counts hours inside a day", () => {
    const local = new Date(now.getTime() + 3 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
    const time = `${pad(local.getHours())}:${pad(local.getMinutes())}`;
    const r = describeWhen(date, time, now, tz);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("in 3 hours");
  });

  it("refuses an empty field, a bad value and the past, each in its own words", () => {
    expect(describeWhen("", "10:00", now, tz)).toEqual({ ok: false, text: "Pick a date and a time." });
    expect(describeWhen("nonsense", "10:00", now, tz).text).toBe("Couldn’t read that date and time.");
    expect(describeWhen("2026-09-01", "10:00", now, tz).text).toBe("That time has already passed.");
  });
});

describe("the primary button", () => {
  it("says what it will do", () => {
    const now = new Date("2026-09-10T09:00:00Z");
    expect(primaryLabel("now", null)).toBe("Send now");
    expect(primaryLabel("later", null)).toBe("Schedule");
    expect(primaryLabel("later", describeWhen("", "", now, "UTC"))).toBe("Schedule");
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(primaryLabel("later", describeWhen("2026-09-12", "10:00", now, here))).toBe(
      "Schedule for Sat 12 Sept, 10:00",
    );
  });
});

describe("the armed status line", () => {
  it("is one line: when, and for how many", () => {
    expect(scheduledSummary("2026-09-12T09:00:00.000Z", 240, "UTC")).toBe(
      "Scheduled · Sat 12 Sept, 09:00 · 240 people",
    );
    expect(scheduledSummary(null, 1, "UTC")).toBe("Sending now · 1 person");
  });
});
