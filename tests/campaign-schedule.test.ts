import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { CampaignStatus } from "../db/schema";
import {
  canCancelSchedule,
  canDiscardRecipients,
  canSchedule,
  daysToDrain,
  describeDrain,
  parseScheduleTime,
  sweepsToDrain,
  SCHEDULE_MAX_AHEAD_MS,
  SCHEDULE_PAST_TOLERANCE_MS,
  SWEEPS_PER_DAY,
} from "../lib/campaign-schedule";
import { RECIPIENTS_PER_SWEEP } from "../lib/campaign-cron";

/**
 * The campaign state machine, asserted rather than reasoned about.
 *
 * Pure policy only — lib/campaign-schedule.ts imports no database and no
 * node:crypto, so this suite runs with no DATABASE_URL like every other suite
 * here. The IO half (lib/campaign-send.ts) re-states every rule below as a
 * predicate inside the mutating statement, which is the part that holds against
 * a concurrent sweep; these tests pin the rule those predicates encode.
 *
 * The transitions exist at all because nothing in the product could previously
 * write `status = 'scheduled'` or `scheduled_at`, which left
 * `promoteDueScheduledCampaigns` matching zero rows for ever and the entire
 * send pipeline behind it unreachable.
 */

const ALL_STATUSES: CampaignStatus[] = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
];

const NOW = new Date("2026-08-22T09:00:00.000Z");

describe("which transitions are legal", () => {
  it("allows scheduling only from draft or scheduled", () => {
    expect(ALL_STATUSES.filter(canSchedule)).toEqual(["draft", "scheduled"]);
  });

  it("allows cancelling only from scheduled", () => {
    expect(ALL_STATUSES.filter(canCancelSchedule)).toEqual(["scheduled"]);
  });

  it("allows discarding recipients only from draft", () => {
    // NOT draft|scheduled. An armed campaign can be promoted by the sweep
    // between the check and the DELETE; cancelling first closes that window
    // rather than narrowing it.
    expect(ALL_STATUSES.filter(canDiscardRecipients)).toEqual(["draft"]);
  });

  it("is ONE WAY from sending onwards", () => {
    // The invariant that matters most. Nothing may re-arm, cancel, or strip
    // the recipients off a campaign whose rows have been claimed — "un-send"
    // is not a state transition, it is a lie about what already left.
    for (const status of ["sending", "sent", "failed"] as CampaignStatus[]) {
      expect(canSchedule(status)).toBe(false);
      expect(canCancelSchedule(status)).toBe(false);
      expect(canDiscardRecipients(status)).toBe(false);
    }
  });
});

describe("parseScheduleTime", () => {
  it("treats an absent, null or empty time as 'now' — the send-now path", () => {
    // "Send now" is not a second code path: it is this one field left out.
    for (const body of [{}, { scheduledAt: null }, { scheduledAt: "" }]) {
      const result = parseScheduleTime(body, NOW);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.immediate).toBe(true);
        expect(result.when.getTime()).toBe(NOW.getTime());
      }
    }
  });

  it("accepts a future instant unchanged", () => {
    const when = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    const result = parseScheduleTime({ scheduledAt: when.toISOString() }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.immediate).toBe(false);
      expect(result.when.toISOString()).toBe(when.toISOString());
    }
  });

  it("clamps a slightly-stale time to now instead of erroring", () => {
    // Clocks disagree and the request took a moment to arrive. Rejecting a
    // four-second-old time would be a bug report, not a safety feature.
    const when = new Date(NOW.getTime() - SCHEDULE_PAST_TOLERANCE_MS + 1_000);
    const result = parseScheduleTime({ scheduledAt: when.toISOString() }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.immediate).toBe(true);
      expect(result.when.getTime()).toBe(NOW.getTime());
    }
  });

  it("refuses a time that has genuinely passed", () => {
    const when = new Date(NOW.getTime() - SCHEDULE_PAST_TOLERANCE_MS - 1_000);
    const result = parseScheduleTime({ scheduledAt: when.toISOString() }, NOW);
    expect(result.ok).toBe(false);
  });

  it("refuses a time beyond the horizon", () => {
    const when = new Date(NOW.getTime() + SCHEDULE_MAX_AHEAD_MS + 60_000);
    const result = parseScheduleTime({ scheduledAt: when.toISOString() }, NOW);
    expect(result.ok).toBe(false);
  });

  it("refuses garbage rather than silently sending now", () => {
    // A body that cannot be read must NOT fall through to "immediately".
    for (const scheduledAt of [
      "tomorrow",
      "not-a-date",
      {},
      [],
      true,
      Number.NaN,
    ]) {
      expect(parseScheduleTime({ scheduledAt }, NOW).ok).toBe(false);
    }
  });

  it("accepts an epoch number", () => {
    const ms = NOW.getTime() + 60 * 60 * 1000;
    const result = parseScheduleTime({ scheduledAt: ms }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.when.getTime()).toBe(ms);
  });
});

describe("throughput arithmetic agrees with the deployed cron", () => {
  it("SWEEPS_PER_DAY matches the GitHub Actions schedule", () => {
    // The mismatch this pins: lib/campaign-cron.ts derives 75 recipients from a
    // SIXTY-SECOND function budget, which reads like 75/minute. The workflow
    // decides how often that minute happens. If somebody changes the cron step,
    // this fails rather than the composer quietly misstating throughput.
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/campaign-sweep.yml"),
      "utf8",
    );

    const cron = /^\s*-\s*cron:\s*['"]([^'"]+)['"]/m.exec(workflow);
    expect(cron).not.toBeNull();

    const [minute, hour] = (cron?.[1] ?? "").split(" ");
    // A `*/N` minute step over every hour is 1440/N runs a day.
    const step = /^\*\/(\d+)$/.exec(minute ?? "");
    expect(step).not.toBeNull();
    expect(hour).toBe("*");
    expect(SWEEPS_PER_DAY).toBe(1440 / Number(step?.[1]));
  });

  it("is not also scheduled by Vercel — one scheduler, not two", () => {
    // Both drivers running would double the tick rate the composer's estimates
    // are computed from, and would spend two invocations' budget on the same
    // rows. The Vercel `crons` entry was removed when the workflow landed.
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: unknown[] };
    expect(config.crons).toBeUndefined();
  });

  it("puts a 40,000-recipient campaign at a couple of days, not an hour", () => {
    expect(sweepsToDrain(40_000, 75)).toBe(534);
    expect(daysToDrain(40_000, 75)).toBe(2);
    // And with the real constant, so a change to it shows up here.
    expect(daysToDrain(40_000, RECIPIENTS_PER_SWEEP)).toBeGreaterThan(1);
  });

  it("says 'days' out loud rather than implying it finishes in minutes", () => {
    const text = describeDrain(40_000, 75);
    expect(text).toContain("534");
    expect(text).toContain("days");
    expect(text).toContain("every five minutes");
    // A ceiling, stated as a floor on elapsed time — the schedule is best
    // effort and a dropped tick only ever makes this longer.
    expect(text).toContain("at least");
  });

  it("handles the small and empty cases without inventing a number", () => {
    expect(sweepsToDrain(0, 75)).toBe(0);
    expect(sweepsToDrain(-5, 75)).toBe(0);
    expect(describeDrain(0, 75)).toContain("no queued recipients");
    expect(sweepsToDrain(75, 75)).toBe(1);
    expect(sweepsToDrain(76, 75)).toBe(2);
  });

  it("never divides by zero if the batch size is ever misconfigured", () => {
    expect(sweepsToDrain(100, 0)).toBe(100);
    expect(Number.isFinite(daysToDrain(100, 0))).toBe(true);
  });
});
