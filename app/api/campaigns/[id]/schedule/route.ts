import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { cancelCampaignSchedule, scheduleCampaign } from "@/lib/campaign-send";
import { parseScheduleTime } from "@/lib/campaign-schedule";

/**
 * POST   /api/campaigns/:id/schedule  → arm the campaign  (draft → scheduled)
 * DELETE /api/campaigns/:id/schedule  → disarm it         (scheduled → draft)
 *
 * These two are the transition the product was missing. Nothing else in the
 * codebase writes `campaigns.status = 'scheduled'` or `campaigns.scheduled_at`,
 * so before this route existed `promoteDueScheduledCampaigns` matched zero rows
 * on every tick and the whole send pipeline behind it was dead code.
 *
 * ── THIS ROUTE DOES NOT SEND EMAIL, INCLUDING ON "SEND NOW" ──
 *
 * It writes two columns. What that buys is visibility to the scheduled sweep
 * (app/api/cron/campaigns/route.ts), which runs about every five minutes on a
 * best-effort GitHub Actions schedule and hands each
 * message to the deliverer returned by `createCampaignDeliverer()` — the
 * LOG-ONLY one, unless `CAMPAIGN_DELIVERY_MODE=ses`, which is set in no
 * environment. So a campaign scheduled through here will, at the next sweep,
 * write log lines and mark rows `sent`, and transmit nothing to anybody. The
 * composer says exactly that on screen; see Composer.tsx.
 *
 * There is still deliberately NO route that calls `sendCampaignBatch`.
 *
 * ── "SEND NOW" IS THE SAME CODE PATH ──
 *
 * The body carries one optional field, `scheduledAt`. Omitted, null or empty
 * means "now", which the very next sweep finds due. There is no second branch
 * that skips straight to `sending`, because that branch would be the one that
 * eventually skipped a precondition.
 *
 * ── TENANCY ──
 *
 * Both handlers pass the active workspace down to a single UPDATE that carries
 * `workspace_id` in its own WHERE. An id belonging to another tenant matches
 * zero rows and comes back 404 without anything having been read or written.
 */

function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/campaigns/[id]/schedule">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const campaignId = idFrom((await ctx.params).id);
  if (campaignId === null) {
    return json({ error: "Invalid campaign id" }, { status: 400 });
  }

  let body: { scheduledAt?: unknown };
  try {
    body = (await req.json()) as { scheduledAt?: unknown };
  } catch {
    // No body at all is a legitimate "as soon as possible" request.
    body = {};
  }

  const when = parseScheduleTime(body, new Date());
  if (!when.ok) return json({ error: when.error }, { status: 400 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const result = await scheduleCampaign(workspace.id, campaignId, when.when);
  if (result === null) return json({ error: "Not found" }, { status: 404 });

  if ("error" in result) {
    if (result.error === "no_list") {
      return json(
        { error: "Choose an audience list before scheduling this campaign." },
        { status: 409 },
      );
    }
    if (result.error === "no_recipients") {
      // The guard that matters most. A campaign armed with no queued rows
      // would be promoted, drain instantly, and be reported as sent to an
      // audience of nobody — while being past isEditableStatus and therefore
      // unfixable.
      return json(
        {
          error:
            "This campaign has no queued recipients. Queue them first — a campaign with an empty audience would be marked sent without reaching anyone.",
        },
        { status: 409 },
      );
    }
    return json(
      {
        error:
          "This campaign has already started sending and can’t be scheduled again.",
      },
      { status: 409 },
    );
  }

  return json({ ok: true, campaign: result, immediate: when.immediate });
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/campaigns/[id]/schedule">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const campaignId = idFrom((await ctx.params).id);
  if (campaignId === null) {
    return json({ error: "Invalid campaign id" }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const result = await cancelCampaignSchedule(workspace.id, campaignId);
  if (result === null) return json({ error: "Not found" }, { status: 404 });

  if ("error" in result) {
    // Either it was never armed, or the sweep already promoted it. Both are
    // "there is no schedule here to cancel", and the second is not something
    // this route may undo: `sending` is one way.
    return json(
      {
        error:
          "This campaign isn’t scheduled. A campaign that has already started sending can’t be pulled back.",
      },
      { status: 409 },
    );
  }

  return json({ ok: true, campaign: result });
}
