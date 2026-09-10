import type { CampaignStatus } from "@/db/schema";

/**
 * The schedule card's readiness checklist and its "when" readout.
 *
 * ── WHY THIS IS A LIST AND NOT A DISABLED BUTTON ──
 * Until 10 Sep 2026 the composer ended in five disabled buttons across two
 * cards and one grey line naming only the FIRST unmet condition. The order
 * (save → choose a list → queue → fix placeholders → postal address → send)
 * was real, and invisible; people found it one step at a time. A checklist
 * shows the whole chain at once, ticks steps off as they happen, and makes
 * the disabled primary button explain itself.
 *
 * Pure, so it can be tested: what the composer passes in is state it already
 * holds, and what comes back is what to draw. Nothing here reads the DOM.
 */

export type ReadinessInput = {
  /** The draft has been saved at least once (has an id). */
  saved: boolean;
  /** Unsaved edits on screen. Queueing and sending use what the server holds. */
  dirty: boolean;
  /** An audience list is chosen on the saved draft. */
  listChosen: boolean;
  /** The server's count of people who would be mailed; null until counted. */
  audienceCount: number | null;
  /** Recipient rows queued for this campaign. */
  queued: number;
  /** Bracketed template placeholders still in the body. */
  placeholders: number;
  /** The workspace has a postal address for the footer. */
  postalAddress: boolean;
};

export type ReadinessStep = {
  key: "saved" | "list" | "queued" | "placeholders" | "postal";
  label: string;
  done: boolean;
  /** Where to go to fix it. Only meaningful while not done. */
  fix: "save" | "list" | "queue" | "body" | "settings";
};

export function readinessSteps(i: ReadinessInput): ReadinessStep[] {
  const people =
    i.audienceCount === null
      ? ""
      : ` (${i.audienceCount.toLocaleString()} ${i.audienceCount === 1 ? "person" : "people"})`;
  return [
    {
      key: "saved",
      label: i.saved && i.dirty ? "Unsaved changes" : "Draft saved",
      done: i.saved && !i.dirty,
      fix: "save",
    },
    {
      key: "list",
      label: `Audience chosen${i.listChosen ? people : ""}`,
      done: i.saved && i.listChosen,
      fix: "list",
    },
    {
      key: "queued",
      label:
        i.queued > 0
          ? `Recipients queued (${i.queued.toLocaleString()})`
          : "Recipients queued",
      done: i.queued > 0,
      fix: "queue",
    },
    {
      key: "placeholders",
      label:
        i.placeholders > 0
          ? `${i.placeholders} placeholder${i.placeholders === 1 ? "" : "s"} still in the body`
          : "No placeholders left in the body",
      done: i.placeholders === 0,
      fix: "body",
    },
    {
      key: "postal",
      label: i.postalAddress ? "Postal address on file" : "Postal address missing",
      done: i.postalAddress,
      fix: "settings",
    },
  ];
}

/** Every step done, and the campaign in a state that can be scheduled. */
export function readyToSend(steps: ReadinessStep[], status: CampaignStatus): boolean {
  return steps.every((s) => s.done) && (status === "draft" || status === "scheduled");
}

export type WhenMode = "now" | "later";

export type WhenReadout =
  | { ok: true; iso: string; text: string }
  | { ok: false; text: string };

const DAY_MS = 86_400_000;

/**
 * Turn a date field and a time field into an instant, and say it back in
 * words: "Thu 12 Sep, 10:00 · in 2 days · Europe/London".
 *
 * Local wall clock, converted to an ISO instant for the server — the server
 * never guesses a timezone. `now` is a parameter so the "in 2 days" part can
 * be tested without a clock.
 */
export function describeWhen(
  date: string,
  time: string,
  now: Date,
  timeZone: string,
): WhenReadout {
  if (!date || !time) return { ok: false, text: "Pick a date and a time." };
  const parsed = new Date(`${date}T${time}`);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, text: "Couldn’t read that date and time." };
  }
  const diff = parsed.getTime() - now.getTime();
  if (diff < 0) return { ok: false, text: "That time has already passed." };

  const when = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(parsed);

  let rel: string;
  if (diff < 60 * 60_000) rel = "within the hour";
  else if (diff < DAY_MS) {
    const h = Math.round(diff / 3_600_000);
    rel = `in ${h} hour${h === 1 ? "" : "s"}`;
  } else {
    const d = Math.round(diff / DAY_MS);
    rel = `in ${d} day${d === 1 ? "" : "s"}`;
  }

  return { ok: true, iso: parsed.toISOString(), text: `${when} · ${rel} · ${timeZone}` };
}

/** The primary button's label follows the choice, so the choice is never a surprise. */
export function primaryLabel(mode: WhenMode, when: WhenReadout | null): string {
  if (mode === "now") return "Send now";
  if (when && when.ok) return `Schedule for ${when.text.split(" · ")[0]}`;
  return "Schedule";
}

/** The one-line status once armed: "Scheduled · Thu 12 Sep, 10:00 · 240 people". */
export function scheduledSummary(
  scheduledAtIso: string | null,
  queued: number,
  timeZone: string,
): string {
  const people = `${queued.toLocaleString()} ${queued === 1 ? "person" : "people"}`;
  if (!scheduledAtIso) return `Sending now · ${people}`;
  const d = new Date(scheduledAtIso);
  if (Number.isNaN(d.getTime())) return `Scheduled · ${people}`;
  const when = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(d);
  return `Scheduled · ${when} · ${people}`;
}
