import type { CampaignStatus } from "@/db/schema";

/**
 * Campaign scheduling POLICY. Pure decisions only — no database, no
 * `lib/config`, no provider, no `process.env`, no `node:crypto`.
 *
 * The split is the same one lib/newsletter.ts / lib/campaign-send.ts and
 * lib/campaign-cron.ts / app/api/cron/campaigns/route.ts already use, for the
 * same two reasons:
 *
 *   1. `db/index.ts` throws at import time when DATABASE_URL is unset and the
 *      test suite runs without one, so the transition rules below are only
 *      assertable if they live somewhere a test can import;
 *   2. the composer is a CLIENT component. It needs the schedulability rules
 *      and the throughput arithmetic to tell the truth on screen, and it
 *      cannot reach lib/campaign-cron.ts (node:crypto) or lib/config
 *      (server-only, and importing it from a client component took production
 *      down once already — see app/(dashboard)/newsletters/page.tsx).
 *
 * The IO half lives in lib/campaign-send.ts, where the workspace predicate
 * goes INSIDE each mutating statement.
 *
 * ── THE STATE MACHINE ──
 *
 *      draft ──schedule──▶ scheduled ──(cron, when due)──▶ sending ──▶ sent
 *        ▲                     │
 *        └───────cancel────────┘
 *
 * Two edges are new (`schedule`, `cancel`); the other two already existed in
 * lib/campaign-send.ts and had no way of ever firing, because nothing in the
 * product could write `status = 'scheduled'` or `scheduled_at`.
 *
 * Everything from `sending` rightwards is ONE WAY. There is no edge back from
 * `sending` or `sent` to `draft` and there must never be one: by the time a
 * campaign is `sending`, `campaign_recipients` rows have been claimed and, on
 * a live deployment, handed to a provider. "Un-send" is not a state
 * transition, it is a lie about what already left the building. `failed` is
 * terminal for the same reason — it is reached only from `sending`.
 *
 * ── WHY NONE OF THIS IS A `status` FIELD ON THE PATCH BODY ──
 *
 * The obvious implementation is to let PATCH /api/campaigns/:id carry
 * `status`. That would make every rule above advisory: one request body could
 * move a half-sent campaign back to `draft`, or move a draft with no audience
 * straight to `sending`. Each edge below is therefore its own endpoint with
 * its own preconditions, and `updateCampaign` writes a fixed set of content
 * columns that does not include `status` or `scheduled_at`.
 */

// ── Which transitions are legal ──────────────────────────────────

/**
 * May this campaign be scheduled (or re-scheduled to a different time)?
 *
 * `scheduled → scheduled` is allowed deliberately: changing your mind about
 * the time before anything has been claimed is not a state change, and the
 * alternative is forcing a cancel/re-schedule round trip that briefly disarms
 * the campaign for no reason.
 */
export function canSchedule(status: CampaignStatus): boolean {
  return status === "draft" || status === "scheduled";
}

/** May the schedule be cancelled, returning the campaign to `draft`? */
export function canCancelSchedule(status: CampaignStatus): boolean {
  return status === "scheduled";
}

/**
 * May queued recipient rows be thrown away?
 *
 * `draft` ONLY, not `draft | scheduled`. A scheduled campaign is armed: the
 * cron sweep may promote it to `sending` between the moment this returns true
 * and the moment the DELETE lands. Requiring a cancel first makes that window
 * impossible instead of merely unlikely, and it makes the sequence legible in
 * the UI — cancel, then unqueue.
 *
 * `sending`/`sent` are refused outright and the refusal is not about races:
 * those rows are the campaign report. Deleting a `sent` row destroys the only
 * record that a person was mailed, which is the evidence an unsubscribe
 * complaint is answered with.
 */
export function canDiscardRecipients(status: CampaignStatus): boolean {
  return status === "draft";
}

// ── When ─────────────────────────────────────────────────────────

/**
 * How far into the past a requested time may sit before it is an error rather
 * than "now".
 *
 * Not zero. The browser sends a wall-clock time the client picked seconds ago,
 * clocks disagree, and the request takes a moment to arrive — rejecting a time
 * that is four seconds stale would be a bug report, not a safety feature.
 * Anything inside the tolerance is clamped to now, which is the same code path
 * "send now" takes.
 */
export const SCHEDULE_PAST_TOLERANCE_MS = 120_000;

/**
 * The furthest ahead a campaign may be scheduled.
 *
 * A cap exists because a typo in a year field ("2206") otherwise produces a
 * campaign that sits `scheduled` forever, holding its materialised recipients,
 * with the UI cheerfully reporting that it is armed.
 */
export const SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type ScheduleTime =
  | { ok: true; when: Date; immediate: boolean }
  | { ok: false; error: string };

/**
 * Resolve the requested send time.
 *
 * ── "SEND NOW" IS NOT A SECOND CODE PATH ──
 *
 * There is one field. Omit `scheduledAt` (or send null, or an empty string)
 * and the campaign is scheduled for `now`, which the very next sweep will
 * find due. "Send now" and "send at 09:00 on Thursday" therefore produce
 * exactly the same row shape — `status = 'scheduled'`, a non-null
 * `scheduled_at` — and are promoted by exactly the same statement. A separate
 * "send immediately" branch would be a second way into `sending` and would,
 * inevitably, be the one that skipped a precondition.
 *
 * `immediate` is returned for the UI copy only. Nothing downstream branches
 * on it.
 */
export function parseScheduleTime(
  body: { scheduledAt?: unknown },
  now: Date,
): ScheduleTime {
  const raw = body.scheduledAt;

  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, when: now, immediate: true };
  }

  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, error: "Couldn’t read that date and time." };
  }

  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: "Couldn’t read that date and time." };
  }

  const delta = when.getTime() - now.getTime();

  if (delta < -SCHEDULE_PAST_TOLERANCE_MS) {
    return {
      ok: false,
      error:
        "That time has already passed. Pick a future time, or choose “as soon as the next sweep runs”.",
    };
  }

  if (delta > SCHEDULE_MAX_AHEAD_MS) {
    return {
      ok: false,
      error: "A campaign can be scheduled at most a year ahead.",
    };
  }

  // Inside the tolerance but in the past: this IS "now", and saying so keeps
  // one code path rather than writing a `scheduled_at` the sweep would treat
  // as due anyway.
  if (delta <= 0) return { ok: true, when: now, immediate: true };

  return { ok: true, when, immediate: false };
}

// ── What scheduling actually buys you, in real numbers ───────────

/**
 * How many times a day the sweep runs.
 *
 * ── THIS NUMBER IS ONE, AND IT IS THE WHOLE THROUGHPUT STORY ──
 *
 * vercel.json schedules `/api/cron/campaigns` at `0 3 * * *` — once a day, at
 * 03:00. That is not a preference. Vercel's Hobby plan accepts only
 * once-per-day cron expressions; a sub-daily schedule FAILS THE DEPLOYMENT, so
 * the cadence cannot be raised from this repo. It changes when the account
 * changes, and not before.
 *
 * The consequence is severe and is easy to state wrongly. `RECIPIENTS_PER_SWEEP`
 * in lib/campaign-cron.ts is 75, derived from a 60-second function budget —
 * i.e. 75 recipients per INVOCATION. With one invocation a day that is 75
 * recipients per DAY, not 75 per minute. A 40,000-recipient campaign needs
 * ~534 sweeps, which at this cadence is about 534 days.
 *
 * Every figure the composer shows about how long a campaign takes is computed
 * from this constant, so it cannot quietly describe a throughput the deployed
 * cron does not have.
 */
export const SWEEPS_PER_DAY = 1;

/** Sweeps needed to drain `recipients` at `perSweep` rows per sweep. */
export function sweepsToDrain(recipients: number, perSweep: number): number {
  if (recipients <= 0) return 0;
  return Math.ceil(recipients / Math.max(1, perSweep));
}

/** Days needed to drain, at the deployed cadence. */
export function daysToDrain(recipients: number, perSweep: number): number {
  return Math.ceil(sweepsToDrain(recipients, perSweep) / SWEEPS_PER_DAY);
}

/**
 * The drain estimate in a sentence, for the composer.
 *
 * Deliberately blunt and deliberately not rounded down. A client who queues
 * 40,000 people is entitled to read "about 534 days" on the screen where they
 * arm it, rather than discover it from a progress bar that has not moved.
 */
export function describeDrain(recipients: number, perSweep: number): string {
  if (recipients <= 0) return "There are no queued recipients to work through.";

  const sweeps = sweepsToDrain(recipients, perSweep);
  const days = daysToDrain(recipients, perSweep);
  const rows = recipients.toLocaleString();

  if (sweeps <= 1) {
    return `${rows} queued — one sweep’s worth. The sweep runs once a day, so the first run after the scheduled time would work through all of them.`;
  }

  const per = perSweep.toLocaleString();
  return `${rows} queued, and a sweep works through at most ${per}. That is ${sweeps.toLocaleString()} sweeps, and the sweep runs once a day — roughly ${days.toLocaleString()} days from the scheduled time before the last person is reached.`;
}
