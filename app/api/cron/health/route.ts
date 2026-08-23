import * as Sentry from "@sentry/nextjs";
import { json } from "@/lib/http";
import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/campaign-cron";
import { listWorkspaceSummaries } from "@/lib/data";
import { listSendingCampaigns } from "@/lib/campaign-send";
import { buildHealthReport } from "@/lib/health-report";
import { pruneRateLimits } from "@/lib/rate-limit-store";

/**
 * GET /api/cron/health — the daily "is anything broken?" sweep.
 *
 * ── WHY THIS IS A SEPARATE JOB ──
 * It would have been cheaper to bolt onto the campaign sweep, which already
 * runs every few minutes and already authenticates. Two reasons not to:
 * a health check running 72 times a day either spams Sentry or needs a
 * throttle built out of clock arithmetic, and coupling the two means an
 * outage in sending takes the monitoring down with it. The thing that tells
 * you the pipeline is broken should not share a failure mode with the
 * pipeline.
 *
 * ── WHAT IT IS FOR ──
 * lib/workspace-health.ts and lib/campaign-health.ts can both say something is
 * wrong, and both are PULL — they render when a human opens the right screen.
 * Open Door Bakery's contact form was broken for six weeks precisely because
 * nothing pushed. This is the push.
 *
 * Same secret as the campaign sweep, so there is one credential to rotate
 * rather than two, and the same fail-closed behaviour: no secret, no callers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const auth = authorizeCronRequest(
    req.headers.get("authorization"),
    process.env[CRON_SECRET_ENV],
  );
  if (!auth.ok) {
    console.error(auth.log);
    return json({ error: auth.error }, { status: auth.status });
  }

  const now = new Date();
  const [workspaces, sending, pruned] = await Promise.all([
    listWorkspaceSummaries(),
    listSendingCampaigns(),
    // Housekeeping, not health: rate_limits gains a row per distinct bucket,
    // and the IP-keyed buckets on the public endpoints mean that is one row
    // per distinct visitor. Nothing else deletes them.
    pruneRateLimits(),
  ]);

  const report = buildHealthReport({
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      pending: w.pending,
      createdAt: w.createdAt,
      totalCount: w.totalCount,
      firstTicketAt: w.firstTicketAt,
      lastTicketAt: w.lastTicketAt,
    })),
    sendingCampaigns: sending.map((c) => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      workspaceId: c.workspaceId,
      workspaceName: c.workspaceName,
      queued: c.queued,
      sendingSinceDays: Math.floor(
        (now.getTime() - c.since.getTime()) / DAY_MS,
      ),
    })),
    now,
  });

  for (const alert of report.alerts) {
    // withScope, not setTag on the global scope: these run in a loop, and a
    // tag set globally would leak from one alert onto the next.
    Sentry.withScope((scope) => {
      // The fingerprint is the whole reason this is useful. Sentry groups on
      // it, so a workspace that has been quiet for thirty days is ONE issue
      // whose count rises rather than thirty separate issues — which is the
      // difference between an alert and a channel the operator mutes.
      scope.setFingerprint([alert.fingerprint]);
      scope.setLevel(alert.level);
      scope.setTag("alert_kind", alert.kind);
      scope.setTag("workspace_id", String(alert.workspaceId));
      // Detail as context, not as part of the message: the message is the
      // grouping title and must stay stable while the day counts move.
      scope.setContext("health", { detail: alert.detail });
      Sentry.captureMessage(alert.title, alert.level);
    });
  }

  // Logged as well as captured. If the DSN is unset the SDK is a no-op and
  // sends nothing — which is the deliberate state until it is configured — and
  // without this line a run in that state is indistinguishable from a run that
  // found nothing wrong.
  console.info(
    "[cron/health] checked %d workspace(s), %d sending campaign(s), raised %d alert(s)",
    report.checked.workspaces,
    report.checked.sendingCampaigns,
    report.alerts.length,
  );
  if (pruned > 0) {
    console.info("[cron/health] pruned %d expired rate-limit window(s)", pruned);
  }

  return json({
    ok: true,
    checked: report.checked,
    prunedRateLimits: pruned,
    alerts: report.alerts.map((a) => ({
      kind: a.kind,
      level: a.level,
      workspaceId: a.workspaceId,
      title: a.title,
      detail: a.detail,
    })),
  });
}
