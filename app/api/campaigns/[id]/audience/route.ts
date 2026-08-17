import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { materialiseAudience, previewAudience } from "@/lib/campaign-send";

/**
 * GET  /api/campaigns/:id/audience  → who WOULD be mailed, writing nothing
 * POST /api/campaigns/:id/audience  → materialise campaign_recipients rows
 *
 * Neither of these sends anything. POST is phase one of the two-phase send
 * described in db/schema.ts: it creates one `queued` row per recipient with
 * INSERT … ON CONFLICT DO NOTHING, so calling it twice — or after a crash, or
 * from a double-clicked button — adds only what was missing and touches
 * nothing already there. It is idempotent, which is precisely why it is safe
 * to expose while phase two is not.
 *
 * Phase two (lib/campaign-send.sendCampaignBatch) has NO route and must not
 * get one until the infrastructure in docs/NEWSLETTER.md exists.
 */

function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/campaigns/[id]/audience">,
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

  const result = await previewAudience(workspace.id, campaignId);
  if (result === null) return json({ error: "Not found" }, { status: 404 });
  if ("error" in result) {
    return json({ error: "This campaign has no audience list yet." }, { status: 409 });
  }

  // Addresses are NOT returned — only counts. A preview endpoint that dumps
  // the list would turn "can read one campaign" into "can export the whole
  // marketing database", and the composer only needs the numbers.
  return json({
    recipientCount: result.members.length,
    candidateCount: result.candidateCount,
    skipped: result.skipped,
    skippedTotal: result.skippedTotal,
  });
}

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/campaigns/[id]/audience">,
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

  const result = await materialiseAudience(workspace.id, campaignId);
  if (result === null) return json({ error: "Not found" }, { status: 404 });
  if ("error" in result) {
    if (result.error === "no_list") {
      return json(
        { error: "Choose an audience list before preparing this campaign." },
        { status: 409 },
      );
    }
    return json(
      { error: "This campaign has already started sending." },
      { status: 409 },
    );
  }

  return json({
    ok: true,
    inserted: result.inserted,
    total: result.total,
    skipped: result.selection.skipped,
    skippedTotal: result.selection.skippedTotal,
  });
}
