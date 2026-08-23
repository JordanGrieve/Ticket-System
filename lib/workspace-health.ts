/**
 * Has this workspace's integration stopped working, or is it just quiet?
 *
 * ── WHY ──
 * Open Door Bakery's contact form failed for every visitor from 12 July to
 * 22 August. Postbox returned 401 to their site over and over and told nobody.
 * The admin screen showed the workspace as "No enquiries yet" in muted grey —
 * which reads as "new client, nothing yet" and is exactly how six weeks passed.
 * It was found because the client complained.
 *
 * The product could not tell those two states apart, so it showed the
 * reassuring one. That is the bug this module exists to fix.
 *
 * ── THE HARD PART IS NOT DETECTING SILENCE ──
 * It is not crying wolf. A bakery that gets two enquiries a month is not
 * broken when a fortnight passes; flag that and the operator learns to ignore
 * the flag, which leaves them exactly where they started but with more noise.
 *
 * So a workspace with a history is judged against ITS OWN rate — the average
 * gap between the enquiries it has actually received — and only flagged when
 * the current silence is several times longer than normal. A workspace with no
 * history has no rate to compare against, so it gets the one judgement that
 * needs no baseline: a live contact form that has produced NOTHING in weeks is
 * more likely to be broken than to be unpopular.
 *
 * Pure: takes `now` as an argument, so every threshold is testable without
 * waiting six weeks to find out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a brand-new workspace is given before silence becomes suspicious.
 * Below this, silence is just a client who has not shipped the snippet yet.
 */
export const GRACE_DAYS = 14;

/**
 * How many times its own average gap a workspace must exceed before it counts
 * as gone quiet. Three is deliberately forgiving — at 2x, ordinary variance in
 * a low-volume inbox trips it constantly.
 */
export const QUIET_MULTIPLE = 3;

/** Never flag before this, no matter how chatty the workspace normally is. */
export const MIN_QUIET_DAYS = 10;

export type WorkspaceHealthInput = {
  /** Placeholder owner who has never signed in. */
  pending: boolean;
  /** When the workspace was created. */
  createdAt: Date;
  /** Total enquiries ever received. */
  totalCount: number;
  /** Oldest and newest enquiry, or null when none have ever arrived. */
  firstTicketAt: Date | null;
  lastTicketAt: Date | null;
  now: Date;
};

export type WorkspaceHealthState =
  | "invited"
  | "settling"
  | "never_received"
  | "healthy"
  | "gone_quiet";

export type WorkspaceHealth = {
  state: WorkspaceHealthState;
  /** True when somebody should go and look. The whole point of the module. */
  needsAttention: boolean;
  /** Whole days since the last enquiry, or since creation if none ever came. */
  daysSilent: number;
  /**
   * Written for the operator, and states the EVIDENCE rather than a verdict —
   * "37 days, normally about 4" is actionable in a way that "unhealthy" is not.
   */
  detail: string;
};

export function workspaceHealth(input: WorkspaceHealthInput): WorkspaceHealth {
  const ageDays = daysBetween(input.createdAt, input.now);

  if (input.pending) {
    return {
      state: "invited",
      // Not attention-worthy on its own — chasing an invite is a different job
      // from noticing a broken integration, and conflating them means the
      // urgent signal arrives wrapped in the routine one.
      needsAttention: false,
      daysSilent: ageDays,
      detail: `Invited ${ageDays} day${plural(ageDays)} ago, never signed in.`,
    };
  }

  // ── Nothing has ever arrived ──
  if (input.totalCount === 0 || input.lastTicketAt === null) {
    if (ageDays < GRACE_DAYS) {
      return {
        state: "settling",
        needsAttention: false,
        daysSilent: ageDays,
        detail: `Set up ${ageDays} day${plural(ageDays)} ago. Nothing yet, which is normal this early.`,
      };
    }
    return {
      state: "never_received",
      needsAttention: true,
      daysSilent: ageDays,
      detail:
        `Set up ${ageDays} days ago and has never received anything. ` +
        `A live contact form usually produces something — check the snippet ` +
        `is on their site and that the key in it matches.`,
    };
  }

  const daysSilent = daysBetween(input.lastTicketAt, input.now);

  // ── There is a history, but not enough of one to have a rate ──
  // One enquiry gives no gap to average, so fall back to a fixed window rather
  // than inventing a baseline from a single data point.
  if (input.totalCount < 2 || input.firstTicketAt === null) {
    const overdue = daysSilent >= GRACE_DAYS * 2;
    return {
      state: overdue ? "gone_quiet" : "healthy",
      needsAttention: overdue,
      daysSilent,
      detail: overdue
        ? `Only ever received 1 enquiry, and that was ${daysSilent} days ago.`
        : `Last enquiry ${daysSilent} day${plural(daysSilent)} ago.`,
    };
  }

  // ── Judge it against its own rate ──
  const spanDays = daysBetween(input.firstTicketAt, input.lastTicketAt);
  // n enquiries have n-1 gaps between them.
  const averageGap = Math.max(spanDays / (input.totalCount - 1), 0.5);
  const overdue =
    daysSilent >= MIN_QUIET_DAYS && daysSilent >= averageGap * QUIET_MULTIPLE;

  return {
    state: overdue ? "gone_quiet" : "healthy",
    needsAttention: overdue,
    daysSilent,
    detail: overdue
      ? `Nothing for ${daysSilent} days. This workspace normally receives ` +
        `something every ${round1(averageGap)} days.`
      : `Last enquiry ${daysSilent} day${plural(daysSilent)} ago, ` +
        `about every ${round1(averageGap)} days on average.`,
  };
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
