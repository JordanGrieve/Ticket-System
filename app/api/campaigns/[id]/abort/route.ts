import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { abortCampaignSend } from "@/lib/campaign-send";

/**
 * POST /api/campaigns/:id/abort → stop a send in progress (sending → failed)
 *
 * ── THIS IS NOT ./schedule's DELETE ──
 *
 * DELETE /api/campaigns/:id/schedule is CANCEL: `scheduled → draft`, free,
 * reversible, recipients untouched, re-arm whenever you like. This is ABORT:
 * `sending → failed`, terminal, and it leaves an audience half mailed. They are
 * separate routes with separate verbs on purpose. Folding abort into the
 * cancel handler as "a cancel that also works while sending" would mean one
 * request shape covers both the harmless act and the irreversible one, and the
 * client that meant the first would eventually get the second.
 *
 * ── WHY THIS EXISTS AT ALL ──
 *
 * `sending` was a state with no exit. Not editable (isEditableStatus is
 * draft|scheduled), not cancellable (cancelCampaignSchedule requires
 * `scheduled`), recipients not discardable (canDiscardRecipients requires
 * `draft`). A campaign that reached `sending` and could not drain — the
 * workspace's postal address cleared, delivery misconfigured — re-entered the
 * sweep every five minutes indefinitely and nothing in the product could touch
 * it. The schedule route's postal-address gate stops that happening from now
 * on; it does nothing for a campaign already in the trap, or for one whose
 * settings changed after it was armed. This is the way out.
 *
 * ── WHAT IT DOES NOT DO ──
 *
 * It does not un-send. Rows already claimed are already at the provider (the
 * claim marks a row `sent` BEFORE the provider call) and are left exactly as
 * they are, which is why the response returns `alreadySent` — the screen has to
 * be able to say how many people cannot be reached back.
 *
 * ── TENANCY ──
 *
 * The whole transition is one statement carrying `workspace_id` in its own
 * WHERE, so an id from another tenant matches zero rows and comes back 404
 * having written nothing.
 */

function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/campaigns/[id]/abort">,
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

  const result = await abortCampaignSend(workspace.id, campaignId);
  if (result === null) return json({ error: "Not found" }, { status: 404 });

  if ("error" in result) {
    // The campaign exists but is not `sending`. Either it never started, or it
    // has already finished, or somebody stopped it a moment ago. All three are
    // "there is no send here to stop", and none of them is something this
    // route may force: a `draft` or `scheduled` campaign is cancelled, not
    // stopped, and `sent`/`failed` are already terminal.
    return json(
      {
        error:
          "This campaign isn’t sending, so there is nothing to stop. A campaign that has finished — or that was already stopped — can’t be stopped again.",
      },
      { status: 409 },
    );
  }

  return json({
    ok: true,
    stopped: result.stopped,
    alreadySent: result.alreadySent,
  });
}
