import { workspaceHealth, type WorkspaceHealthState } from "./workspace-health";

/**
 * The daily "is anything broken?" sweep, as a pure function.
 *
 * ── WHY THIS EXISTS ──
 * lib/workspace-health.ts and lib/campaign-health.ts can both tell you
 * something is wrong, and both are PULL: they render when a human opens the
 * right screen. A stalled campaign nobody opens is still silent, and a
 * workspace that stopped receiving still needs somebody to visit /admin and
 * notice a red pill. That is the original Open Door Bakery failure in a smaller
 * box — better, because the information now exists, but the first person to
 * learn a client's integration is broken should still not be the client.
 *
 * This turns those signals into events. The caller sends them to Sentry.
 *
 * ── FINGERPRINTS ──
 * Every alert carries a stable fingerprint. Sentry groups by it, so a
 * workspace that has been quiet for thirty days is ONE issue whose count rises,
 * not thirty issues. Without that, a daily job turns a single problem into a
 * daily stream and the operator mutes the lot — which is the same failure mode
 * as a detector that cries wolf, arriving by a different route.
 *
 * The fingerprint deliberately excludes the day count for the same reason. It
 * changes every day; including it would defeat the grouping it exists for.
 *
 * ── NO CUSTOMER CONTENT ──
 * Alerts carry workspace ids, names and counts. Never a ticket subject, an
 * address, or a message body. sentry.server.config.ts turns PII off at the SDK
 * level; this keeps the payloads clean at the source too, because the SDK
 * setting protects captured context, not strings we chose to put in a title.
 */

export type HealthAlertKind = "workspace_silent" | "campaign_stalled";

export type HealthAlert = {
  kind: HealthAlertKind;
  /** Sentry groups on this. Stable across days for the same problem. */
  fingerprint: string;
  /** Sentry issue title. Short, and names the client so it is actionable. */
  title: string;
  detail: string;
  level: "warning" | "error";
  workspaceId: number;
  workspaceName: string;
};

export type WorkspaceHealthRow = {
  id: number;
  name: string;
  pending: boolean;
  createdAt: Date;
  totalCount: number;
  firstTicketAt: Date | null;
  lastTicketAt: Date | null;
};

export type StalledCampaignRow = {
  campaignId: number;
  campaignName: string;
  workspaceId: number;
  workspaceName: string;
  /** Recipients still queued. Zero means it is draining, not stalled. */
  queued: number;
  /** How long it has been in `sending`. */
  sendingSinceDays: number;
};

export type HealthReport = {
  alerts: HealthAlert[];
  /** Counts for the route's JSON response, so a run is legible without Sentry. */
  checked: { workspaces: number; sendingCampaigns: number };
};

/**
 * How long a campaign may sit in `sending` with queued rows before it counts
 * as stalled rather than merely slow.
 *
 * The sweep is best-effort and GitHub delays it — observed cadence is nearer
 * twenty minutes than the five the cron expression asks for — and a large
 * audience legitimately takes days to drain. A day of no progress is well past
 * anything the schedule explains.
 */
export const CAMPAIGN_STALL_DAYS = 1;

export function buildHealthReport(input: {
  workspaces: WorkspaceHealthRow[];
  sendingCampaigns: StalledCampaignRow[];
  now: Date;
}): HealthReport {
  const alerts: HealthAlert[] = [];

  for (const w of input.workspaces) {
    const health = workspaceHealth({
      pending: w.pending,
      createdAt: w.createdAt,
      totalCount: w.totalCount,
      firstTicketAt: w.firstTicketAt,
      lastTicketAt: w.lastTicketAt,
      now: input.now,
    });
    if (!health.needsAttention) continue;

    alerts.push({
      kind: "workspace_silent",
      // State, not day count — see the header.
      fingerprint: `workspace_silent:${w.id}:${health.state}`,
      title: titleFor(health.state, w.name),
      detail: health.detail,
      // Warning, not error: nothing has thrown. Somebody needs to look.
      level: "warning",
      workspaceId: w.id,
      workspaceName: w.name,
    });
  }

  for (const c of input.sendingCampaigns) {
    if (c.queued === 0) continue;
    if (c.sendingSinceDays < CAMPAIGN_STALL_DAYS) continue;

    alerts.push({
      kind: "campaign_stalled",
      fingerprint: `campaign_stalled:${c.workspaceId}:${c.campaignId}`,
      title: `${c.workspaceName}: campaign stuck part-sent`,
      detail:
        `"${c.campaignName}" has been sending for ${c.sendingSinceDays} day(s) ` +
        `with ${c.queued} recipient(s) still queued. A campaign in this state ` +
        `cannot be edited, cancelled or discarded from inside the product.`,
      // Error: a campaign wedged in `sending` is a dead end for the client with
      // no way out, which is worse than a workspace that has gone quiet.
      level: "error",
      workspaceId: c.workspaceId,
      workspaceName: c.workspaceName,
    });
  }

  return {
    alerts,
    checked: {
      workspaces: input.workspaces.length,
      sendingCampaigns: input.sendingCampaigns.length,
    },
  };
}

function titleFor(state: WorkspaceHealthState, name: string): string {
  return state === "never_received"
    ? `${name}: has never received an enquiry`
    : `${name}: has gone quiet`;
}
