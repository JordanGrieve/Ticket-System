import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { getWorkspaceEntitlement } from "@/lib/billing-query";
import { checkAllowance, emailAllowance as emailAllowanceFor } from "@/lib/usage";
import { usedThisMonth } from "@/lib/usage-store";
import { activeWorkspace } from "@/lib/viewer";
import {
  campaignRecipientBreakdown,
  deleteCampaign,
  getCampaign,
  updateCampaign,
} from "@/lib/campaign-send";
import { diagnoseCampaign } from "@/lib/campaign-health";
import { deliveryModeFromEnv, isLiveDeliveryMode } from "@/lib/deliver";
import {
  campaignPatchBody,
  isTemplateKey,
  parseCampaignInput,
  type CampaignDraftInput,
} from "@/lib/newsletter";

/**
 * GET    /api/campaigns/:id  → one campaign plus its per-status recipient counts
 * PATCH  /api/campaigns/:id  → edit a draft
 * DELETE /api/campaigns/:id  → remove a draft
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

  // This month's allowance, so a campaign that has quietly stopped because the
  // month is spent can say so. Failing to read it yields null, which the
  // diagnosis treats as "unknown" rather than "fine".
  const entitlement = await getWorkspaceEntitlement(workspace.id);
  let emailAllowance: { remaining: number; allowance: number } | null = null;
  try {
    const allowance = emailAllowanceFor(entitlement?.plan ?? "trial");
    const used = await usedThisMonth(workspace.id, "emails_sent");
    emailAllowance = { allowance, remaining: checkAllowance(used, allowance).remaining };
  } catch {
    // Left null on purpose. A health panel is not worth failing the request
    // for, and "we could not tell" is an honest answer.
  }

  // The environment is read HERE and the answers passed down as booleans —
  // lib/campaign-health.ts reads no env of its own, which is what lets every
  // one of its branches be tested without breaking production to reproduce
  // them. See its header.
  const health = diagnoseCampaign({
    status: campaign.status,
    recipients,
    postalAddress: workspace.postalAddress,
    emailAllowance,
    env: {
      sweepConfigured: Boolean((process.env.CRON_SECRET ?? "").trim()),
      senderConfigured: Boolean(
        (process.env.CAMPAIGN_FROM_ADDRESS ?? "").trim(),
      ),
      // Asked of lib/deliver rather than compared to a literal here. There are
      // two live modes now ("ses" and "resend") and a screen that knew only
      // about one would tell a client their campaign will not send on the very
      // provider it is about to send through.
      deliveryLive: isLiveDeliveryMode(deliveryModeFromEnv(process.env)),
    },
  });

  return json({ campaign, recipients, health });
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
  //
  // The fallbacks are campaignPatchBody's job rather than a literal here. A
  // literal is how the image and the products came to be wiped by every save:
  // it listed six of the nine fields, and a field nobody mentions is a field
  // that gets written as empty.
  const parsed = parseCampaignInput(
    campaignPatchBody(body, {
      name: existing.name,
      subject: existing.subject,
      preheader: existing.preheader,
      templateKey: isTemplateKey(existing.templateKey)
        ? existing.templateKey
        : "plain",
      body: existing.body,
      listId: existing.listId,
      heroImageUrl: existing.heroImageUrl,
      heroImageAlt: existing.heroImageAlt,
      products: existing.products ?? [],
    }),
  );
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

/**
 * DELETE /api/campaigns/:id — remove a draft.
 *
 * Drafts only. `deleteCampaign` carries `status = 'draft'` inside its own
 * WHERE, so a campaign the sweep promoted a moment ago is refused rather than
 * deleted from under the send loop; the reasoning for each refused state is
 * on that function.
 *
 * 404 and 409 are deliberately different answers. An id belonging to another
 * tenant matches zero rows and is a 404 — the same answer as an id that never
 * existed, so this endpoint cannot be used to discover that some other
 * workspace owns a number. A 409 means "yours, but not a draft", which is a
 * thing the caller can act on.
 */
export async function DELETE(
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

  const result = await deleteCampaign(workspace.id, campaignId);
  if (result === null) return json({ error: "Not found" }, { status: 404 });
  if ("error" in result) {
    return json(
      {
        error:
          "Only a draft can be deleted. Cancel its schedule first, or leave it — a campaign that has sent is the record of what your customers were told.",
      },
      { status: 409 },
    );
  }

  return json({ ok: true, deleted: true });
}
