import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { cancelCampaignSchedule, scheduleCampaign } from "@/lib/campaign-send";
import { parseScheduleTime } from "@/lib/campaign-schedule";
import { mailableSender } from "@/lib/newsletter";
import { runCampaignSweep } from "@/lib/campaign-sweep-run";
import type { SweepSummary } from "@/lib/campaign-cron";

/**
 * How long "Send now" may spend sending before it stops and leaves the rest
 * to the sweep.
 *
 * Twelve seconds, against the cron's forty-five. This one is in front of a
 * person watching a button: long enough to finish a small list outright,
 * short enough that a slow provider does not make the page look broken. The
 * remainder is not lost — every unreached row is still queued.
 */
const INLINE_SEND_DEADLINE_MS = 12_000;

/**
 * POST   /api/campaigns/:id/schedule  → arm the campaign  (draft → scheduled)
 * DELETE /api/campaigns/:id/schedule  → disarm it         (scheduled → draft)
 *
 * These two are the transition the product was missing. Nothing else in the
 * codebase writes `campaigns.status = 'scheduled'` or `campaigns.scheduled_at`,
 * so before this route existed `promoteDueScheduledCampaigns` matched zero rows
 * on every tick and the whole send pipeline behind it was dead code.
 *
 * ── THIS ROUTE DOES SEND EMAIL NOW, ON "SEND NOW" ONLY ──
 *
 * It used to write two columns and leave the rest to the sweep, and this
 * header said at length that no route ever called `sendCampaignBatch`. That
 * was true while the sweep ran every five minutes and while the only provider
 * was a sandboxed SES that could reach nobody. It is not true now: the sweep
 * is HOURLY (a five-minute one keeps the Neon compute awake past the free
 * allowance, and Neon answers that by suspending it), and Resend reaches
 * strangers. "Send now" meaning "within the hour" is not what the button says.
 *
 * So an immediate schedule runs ONE pass of the shared send loop —
 * lib/campaign-sweep-run.ts, the same code the cron calls — before returning.
 *
 * ── "SEND NOW" IS STILL THE SAME CODE PATH ──
 *
 * The body carries one optional field, `scheduledAt`. Omitted, null or empty
 * means "now". There is still no second branch that skips straight to
 * `sending`: the campaign is armed by exactly the same `scheduleCampaign` call
 * with exactly the same preconditions, and only then is the sweep run against
 * it. A branch that reached the deliverer another way would be the one that
 * eventually skipped a precondition.
 *
 * A future schedule is untouched by any of this and waits for the sweep.
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

  // ── The postal address gate ──
  //
  // sendCampaignBatch already refuses to send without one, and that refusal is
  // correct where it sits — but by the time it fires the campaign is `sending`,
  // and `sending` is a trap: not editable (isEditableStatus is draft|scheduled),
  // not cancellable (cancelCampaignSchedule requires `scheduled`), recipients
  // not discardable (canDiscardRecipients requires `draft`). The campaign would
  // re-enter the sweep every five minutes forever, and the only explanation in
  // existence is a console.warn the client cannot see.
  //
  // So the real fix is to never let it be armed. Refusing here costs one 409
  // and leaves the campaign in `draft`, where it can still be fixed.
  if (
    !mailableSender({
      workspaceName: workspace.name,
      legalName: workspace.legalName,
      postalAddress: workspace.postalAddress,
    })
  ) {
    return json(
      {
        error:
          "Add your postal address in Settings before sending. Marketing email must carry a real physical address by law, and Postbox refuses the send rather than leaving it out.",
      },
      { status: 409 },
    );
  }

  const result = await scheduleCampaign(workspace.id, campaignId, when.when);
  if (result === null) return json({ error: "Not found" }, { status: 404 });

  if ("error" in result) {
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

  /*
    ── "SEND NOW" MEANS NOW ──

    Armed for immediately: run one pass of the send loop here, in this request,
    rather than leaving it for the hourly sweep. Before this, "Send now" meant
    "in up to fifty-nine minutes", which for a list of three is a very long
    time to look at a page wondering whether anything happened. Jordan,
    14 Sep 2026: "so wait, when I send it out, it's not straight away, but a
    set time?"

    A faster cron is the obvious alternative and the wrong one: every tick
    wakes the Neon compute for the autosuspend window whether or not there is
    work, and five-minute sweeps run at roughly 180 CU-hours against a 100-hour
    allowance — which Neon Free answers by suspending the compute, i.e. taking
    the product down. Sending inside a request somebody just made adds no
    scheduled wakes at all.

    ── IT CANNOT FAIL THE REQUEST ──
    The campaign IS armed by this point and the row says so. If the pass
    refuses (no envelope configured) or throws (provider down mid-batch), the
    right answer is still 200: the campaign is scheduled, the hourly sweep is
    the safety net it always was, and every unreached row is still `queued`.
    Reporting a failure here would tell somebody their campaign did not send
    when it is queued and will.

    A SHORTER deadline than the cron's. A button that holds a request open for
    forty-five seconds reads as broken; the remainder is exactly what the sweep
    exists for.
  */
  let sent: SweepSummary | null = null;
  if (when.immediate) {
    try {
      const run = await runCampaignSweep({
        onlyCampaignId: campaignId,
        deadlineMs: INLINE_SEND_DEADLINE_MS,
      });
      if (run.ok) sent = run.summary;
      else console.error(`[schedule] inline send skipped: ${run.detail}`);
    } catch (err) {
      console.error("[schedule] inline send failed:", err);
    }
  }

  return json({
    ok: true,
    campaign: result,
    immediate: when.immediate,
    /**
     * What the inline pass managed, or null when there was not one (a future
     * schedule) or it could not run. The composer reports from this rather
     * than claiming a send it cannot see the result of.
     */
    sent,
  });
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
