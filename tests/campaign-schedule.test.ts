import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { CampaignStatus } from "../db/schema";
import {
  canAbortSend,
  canCancelSchedule,
  canDiscardRecipients,
  canSchedule,
  daysToDrain,
  describeAbort,
  describeDrain,
  parseScheduleTime,
  sweepsToDrain,
  ABORT_RECIPIENT_ERROR,
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

describe("the abort edge: sending → failed", () => {
  it("allows aborting only from sending", () => {
    expect(ALL_STATUSES.filter(canAbortSend)).toEqual(["sending"]);
  });

  it("does not break one-wayness — abort moves forward, to a terminal state", () => {
    // `failed` cannot abort, schedule, cancel or discard. Once stopped, a
    // campaign has no transitions left at all, which is the whole reason
    // `failed` is the right landing place: nothing can walk it back to a state
    // where it would be edited or sent again.
    expect(canAbortSend("failed")).toBe(false);
    expect(canSchedule("failed")).toBe(false);
    expect(canCancelSchedule("failed")).toBe(false);
    expect(canDiscardRecipients("failed")).toBe(false);
  });

  it("is not offered where the reversible transitions are", () => {
    // The trap this exists for is `sending` and only `sending`. A scheduled
    // campaign is cancelled — free, reversible, audience untouched — and
    // offering the terminal act there would be the worst kind of helpful.
    for (const status of ["draft", "scheduled"] as CampaignStatus[]) {
      expect(canAbortSend(status)).toBe(false);
    }
    expect(canCancelSchedule("scheduled")).toBe(true);
  });

  it("never overlaps with cancel — no status offers both", () => {
    for (const status of ALL_STATUSES) {
      expect(canAbortSend(status) && canCancelSchedule(status)).toBe(false);
    }
  });

  it("cannot be re-run on an already-stopped campaign", () => {
    // The IO half refuses this too (`AND c.status = 'sending'` inside the
    // UPDATE). Asserted here as well because a second abort would re-stamp
    // recipient rows whose error text already tells the truth.
    expect(canAbortSend("failed")).toBe(false);
    expect(canAbortSend("sent")).toBe(false);
  });

  it("names the stopped rows as a deliberate act, not a delivery failure", () => {
    // Stopped rows land at `failed` beside rows that genuinely bounced, so the
    // error text is the only thing distinguishing them on the report.
    expect(ABORT_RECIPIENT_ERROR).toMatch(/^Stopped:/);
    expect(ABORT_RECIPIENT_ERROR).toContain("stopped this campaign");
    expect(ABORT_RECIPIENT_ERROR).toContain("before this message was sent");
  });
});

describe("the abort confirmation tells the truth about what cannot be undone", () => {
  it("says what has already gone, what never will, and that there is no way back", () => {
    const text = describeAbort({ queued: 8_760, alreadySent: 1_240 });

    // The number already mailed, and that it is beyond reach.
    expect(text).toContain("1,240 people have already been sent this");
    expect(text).toContain("cannot be recalled");
    // The number that will now never be mailed.
    expect(text).toContain("8,760 people are still queued");
    expect(text).toContain("will never be sent this campaign");
    // And that this is terminal.
    expect(text).toContain("cannot be undone");
    expect(text).toContain("marked Failed");
    expect(text).toContain("re-scheduled");
  });

  it("never claims nothing was sent when something was", () => {
    // The failure mode with real-world cost: a confirmation that reads as
    // harmless on a campaign that is half way through a live audience.
    const text = describeAbort({ queued: 10, alreadySent: 1 });
    expect(text).toContain("1 person has already been sent this");
    expect(text).not.toContain("Nothing has been sent yet");
  });

  it("is explicit rather than silent when nobody has been mailed yet", () => {
    // Still a sentence. A zero that is simply omitted reads as an oversight,
    // and this is the one case where the act is genuinely almost harmless —
    // which is worth saying, not worth leaving to be inferred.
    const text = describeAbort({ queued: 500, alreadySent: 0 });
    expect(text).toContain("Nothing has been sent yet");
    expect(text).toContain("500 people are still queued");
    expect(text).toContain("cannot be undone");
  });

  it("handles a campaign with nothing left to stop", () => {
    const text = describeAbort({ queued: 0, alreadySent: 3 });
    expect(text).toContain("Nobody is still queued");
    expect(text).toContain("3 people have already been sent this");
  });

  it("gets the singulars right in both halves", () => {
    const text = describeAbort({ queued: 1, alreadySent: 1 });
    expect(text).toContain("1 person has already been sent this");
    expect(text).toContain("1 person is still queued");
    expect(text).not.toContain("1 people");
    expect(text).not.toContain("persons");
  });

  it("asks a question before it states a consequence", () => {
    // It is a confirm() body. If the first line is not the question, the
    // decision is being made from the middle of a paragraph.
    const text = describeAbort({ queued: 5, alreadySent: 5 });
    expect(text.split("\n")[0]).toBe("Stop this campaign for good?");
  });

  it("does not use the word 'cancel' anywhere", () => {
    // Cancel is the OTHER edge — reversible, scheduled → draft, audience
    // untouched. Sharing the word is how muscle memory built on the harmless
    // act carries into the one that cannot be undone.
    for (const counts of [
      { queued: 0, alreadySent: 0 },
      { queued: 1, alreadySent: 1 },
      { queued: 9_000, alreadySent: 9_000 },
    ]) {
      expect(describeAbort(counts).toLowerCase()).not.toContain("cancel");
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
