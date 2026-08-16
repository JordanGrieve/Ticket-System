import type { BusinessHours, AutoReplySchedule } from "@/db/schema";

/**
 * Business-hours evaluation, in the WORKSPACE'S timezone.
 *
 * The whole point of this file is that "09:00–17:30" is a wall-clock window in
 * an IANA zone — it is not the server's local time (Vercel runs UTC, a laptop
 * runs whatever), and it is not UTC either. It also is not a fixed offset:
 * Europe/London is +00:00 in January and +01:00 in July, so any approach that
 * adds a stored number of hours is wrong twice a year.
 *
 * So we never do arithmetic on offsets or strings. We ask Intl for the
 * wall-clock parts of `now` AS RENDERED IN THAT ZONE — which is exactly the
 * clock the workspace's staff are looking at — and compare minutes-since-
 * midnight against the window. Intl carries the tz database, so DST, historical
 * offset changes and half-hour zones (Asia/Kolkata, Australia/Adelaide) are all
 * handled for free.
 */

/** Intl's `weekday: "short"` output → the 0=Sunday index the schema stores. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Sensible default for a new workspace: weekdays, 09:00–17:00. */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:00",
};

export type ZonedParts = {
  /** 0 = Sunday … 6 = Saturday, in the target zone. */
  weekday: number;
  /** 0–23, in the target zone. */
  hour: number;
  /** 0–59, in the target zone. */
  minute: number;
  /** Minutes since local midnight — what the window comparison uses. */
  minutesOfDay: number;
};

/**
 * Is this a zone Intl actually knows? A typo'd zone must not throw inside the
 * send path, and must not silently become "the server's idea of time" either.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wall-clock parts of `date` as seen in `timeZone`.
 *
 * An unknown zone falls back to UTC rather than to the host's local zone: UTC
 * is at least a defined, stable answer, whereas "whatever this container is
 * set to" would make the same config behave differently per deployment.
 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    // h23 so midnight is 00 rather than the "24" some engines emit for h24.
    hourCycle: "h23",
  }).formatToParts(date);

  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "weekday") weekday = WEEKDAY_INDEX[p.value] ?? 0;
    else if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
  }

  return { weekday, hour, minute, minutesOfDay: hour * 60 + minute };
}

/** "09:30" → 570. Returns null for anything that isn't a valid HH:MM. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Cheap validity check used by the API before it will store a window. */
export function isValidBusinessHours(hours: BusinessHours | null): boolean {
  if (!hours) return true; // "no window configured" is a legal state
  if (!Array.isArray(hours.days)) return false;
  if (hours.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return false;
  const start = parseHHMM(hours.start);
  const end = parseHHMM(hours.end);
  if (start == null || end == null) return false;
  // A zero-length window would mean "open never", which is almost certainly a
  // mistake rather than an intent — reject it at the edge instead of silently
  // never matching.
  if (start === end) return false;
  return true;
}

/**
 * Is `now` inside the window, in the workspace's zone?
 *
 * Half-open: 09:00–17:30 includes 09:00 and excludes 17:30. That keeps a
 * midnight-wrapping window (22:00–06:00) from counting 06:00 twice.
 *
 * A window whose `start` is later than its `end` wraps midnight. `days` names
 * the day the window OPENS on, so 22:00–06:00 on {Fri} covers Friday 22:00
 * through Saturday 06:00 — which is what someone picking "Friday night" means.
 *
 * Returns false when no window is configured or the window is malformed:
 * "inside an undefined window" is not a thing.
 */
export function isWithinBusinessHours(
  now: Date,
  hours: BusinessHours | null | undefined,
  timeZone: string,
): boolean {
  if (!hours || !Array.isArray(hours.days) || hours.days.length === 0) {
    return false;
  }
  const start = parseHHMM(hours.start);
  const end = parseHHMM(hours.end);
  if (start == null || end == null || start === end) return false;

  const { weekday, minutesOfDay } = zonedParts(now, timeZone);
  const days = new Set(hours.days);

  if (start < end) {
    return days.has(weekday) && minutesOfDay >= start && minutesOfDay < end;
  }

  // Wraps midnight.
  if (minutesOfDay >= start) return days.has(weekday);
  if (minutesOfDay < end) return days.has((weekday + 6) % 7); // yesterday
  return false;
}

export type ScheduleDecision = {
  /** Does the schedule permit a send right now? */
  allowed: boolean;
  /** Whether we are inside the window — also picks which body copy to use. */
  inHours: boolean;
  reason:
    | "always"
    | "inside_window"
    | "outside_window"
    | "no_window_configured";
};

/**
 * Apply the workspace's schedule mode.
 *
 * `business_hours` with no window configured resolves to "never" rather than
 * "always": "inside" can never be true without a window, and defaulting the
 * other way would blast auto-replies 24/7 from a half-finished config.
 * `out_of_hours` with no window is therefore always allowed — every moment is
 * outside a window that does not exist.
 */
export function evaluateSchedule(
  mode: AutoReplySchedule,
  now: Date,
  hours: BusinessHours | null | undefined,
  timeZone: string,
): ScheduleDecision {
  const inHours = isWithinBusinessHours(now, hours, timeZone);
  const hasWindow = isWithinWindowConfigured(hours);

  if (mode === "always") {
    return { allowed: true, inHours, reason: "always" };
  }
  if (mode === "business_hours") {
    if (!hasWindow) {
      return { allowed: false, inHours: false, reason: "no_window_configured" };
    }
    return {
      allowed: inHours,
      inHours,
      reason: inHours ? "inside_window" : "outside_window",
    };
  }
  // out_of_hours
  return {
    allowed: !inHours,
    inHours,
    reason: inHours ? "inside_window" : hasWindow ? "outside_window" : "no_window_configured",
  };
}

function isWithinWindowConfigured(
  hours: BusinessHours | null | undefined,
): boolean {
  if (!hours || !Array.isArray(hours.days) || hours.days.length === 0) return false;
  const start = parseHHMM(hours.start);
  const end = parseHHMM(hours.end);
  return start != null && end != null && start !== end;
}

/** "Mon–Fri, 09:00–17:00 (Europe/London)" for the settings summary line. */
export function describeBusinessHours(
  hours: BusinessHours | null | undefined,
  timeZone: string,
): string {
  if (!isWithinWindowConfigured(hours) || !hours) return "No hours set";
  const days = [...hours.days].sort((a, b) => a - b);
  const labels = days.map((d) => DAY_SHORT[d]).join(", ");
  return `${labels} · ${hours.start}–${hours.end} (${timeZone})`;
}
