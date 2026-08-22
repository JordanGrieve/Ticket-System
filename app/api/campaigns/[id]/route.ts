import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import {
  campaignRecipientBreakdown,
  getCampaign,
  updateCampaign,
} from "@/lib/campaign-send";
import { parseCampaignInput, type CampaignDraftInput } from "@/lib/newsletter";

/**
 * GET   /api/campaigns/:id  → one campaign plus its per-status recipient counts
 * PATCH /api/campaigns/:id  → edit a draft
 *
 * Both filter on (id, workspace_id), so an id from another tenant matches zero
 * rows and comes back 404 without touching anything. The recipient counts join
 * campaign_recipients up to campaigns and filter the workspace there —
 * campaign_recipients has no workspace_id of its own.
 *
 * PATCH edits CONTENT ONLY. It cannot move a campaign between states: `status`
 * and `scheduledAt` in the body are a 400, `updateCampaign` writes neither
 * column, and the UPDATE it runs carries `status IN ('draft','scheduled')` in
 * its own WHERE so a campaign the sweep promoted a moment ago is not edited
 * mid-send. Arming and disarming are POST/DELETE on ./schedule.
 */

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/campaigns/[id]">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const campaignId = Number((await ctx.params).id);
  if (!Number.isInteger(campaignId)) {
    return json({ error: "Invalid campaign id" }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const campaign = await getCampaign(workspace.id, campaignId);
  if (!campaign) return json({ error: "Not found" }, { status: 404 });

  const recipients = await campaignRecipientBreakdown(workspace.id, campaignId);
  return json({ campaign, recipients });
}

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/campaigns/[id]">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const campaignId = Number((await ctx.params).id);
  if (!Number.isInteger(campaignId)) {
    return json({ error: "Invalid campaign id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // Refused LOUDLY rather than ignored. `parseCampaignInput` would drop these
  // keys silently and the caller would believe the campaign had been armed or
  // cancelled when nothing of the sort happened. State transitions live at
  // POST/DELETE /api/campaigns/:id/schedule, each with its own preconditions —
  // see the state machine in lib/campaign-schedule.ts.
  if ("status" in body || "scheduledAt" in body) {
    return json(
      {
        error:
          "A campaign’s status and send time can’t be edited here. Use the schedule endpoint.",
      },
      { status: 400 },
    );
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const existing = await getCampaign(workspace.id, campaignId);
  if (!existing) return json({ error: "Not found" }, { status: 404 });

  // A PATCH is validated as a whole campaign: unspecified fields fall back to
  // what is stored, so partial edits go through exactly the same rules a
  // create does. Validating only the supplied keys would let a campaign reach
  // a state the create path would have rejected.
  const parsed = parseCampaignInput({
    name: body.name ?? existing.name,
    subject: body.subject ?? existing.subject,
    preheader: body.preheader === undefined ? existing.preheader : body.preheader,
    templateKey: body.templateKey ?? existing.templateKey,
    body: body.body ?? existing.body,
    listId: body.listId === undefined ? existing.listId : body.listId,
  });
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

  const patch: Partial<CampaignDraftInput> = parsed.value;
  const result = await updateCampaign(workspace.id, campaignId, patch);

  if (result === null) return json({ error: "Not found" }, { status: 404 });
  if ("error" in result) {
    if (result.error === "unknown_list") {
      return json(
        { error: "That audience list doesn't exist." },
        { status: 404 },
      );
    }
    if (result.error === "list_locked") {
      return json(
        {
          error:
            "This campaign is scheduled. Cancel the schedule before changing its audience list — its recipients were already built from the old one.",
        },
        { status: 409 },
      );
    }
    return json(
      { error: "This campaign has started sending and can't be edited." },
      { status: 409 },
    );
  }

  return json({ ok: true, campaign: result });
}
