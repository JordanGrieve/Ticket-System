import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { duplicateCampaign } from "@/lib/campaign-send";

/**
 * POST /api/campaigns/:id/duplicate → a fresh draft with the same content.
 *
 * ── WHY THE PRODUCT NEEDS THIS ──
 * A campaign that has been sent is locked, and it should be: the row is the
 * record of what went to whom, and editing it would leave every recipient row
 * describing an email that never existed. But until this route the only way
 * forward from that lock was to retype the whole thing, which is why the lock
 * read as an obstacle rather than as a rule.
 *
 * ── IT COPIES CONTENT, NEVER HISTORY ──
 * The new campaign is a draft with no schedule, no recipients, no sent time
 * and no provider ids. Those belong to the send that already happened. See
 * duplicateCampaign, where the copy is built through `draftColumns` so a field
 * added later cannot be quietly left behind.
 *
 * ── A WRITE, SO IT IS A POST ──
 * And scoped by `activeWorkspace()` exactly like every other campaign route:
 * the id in the path is checked against the caller's workspace inside
 * duplicateCampaign, and a campaign belonging to somebody else is a 404 rather
 * than a 403 — an id that is not yours should not be confirmable as existing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
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

  const created = await duplicateCampaign(workspace.id, campaignId);
  if (!created) return json({ error: "Not found" }, { status: 404 });

  return json({ ok: true, campaign: { id: created.id, name: created.name } });
}
