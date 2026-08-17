import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { createCampaign, listCampaigns } from "@/lib/campaign-send";
import { parseCampaignInput } from "@/lib/newsletter";

/**
 * GET  /api/campaigns  → this workspace's campaigns, newest first
 * POST /api/campaigns  → create a draft
 *
 * Both scoped to the active workspace. `campaigns` carries workspace_id, so
 * the filter is direct; the list name on each row is joined with the same
 * workspace predicate so a cross-tenant list id renders as null rather than
 * leaking a name.
 *
 * There is deliberately NO send endpoint here, and none should be added until
 * the scheduling infrastructure described in docs/NEWSLETTER.md exists.
 * Creating and materialising a campaign cannot email anybody; sending can, and
 * the send loop in lib/campaign-send.ts is unreachable from app/ on purpose.
 */

export async function GET() {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  return json({ campaigns: await listCampaigns(workspace.id) });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const parsed = parseCampaignInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const created = await createCampaign(workspace.id, parsed.value);
  if ("error" in created) {
    // The list id isn't this workspace's. 404 rather than 403: confirming that
    // some other tenant owns it is itself a leak.
    return json({ error: "That audience list doesn't exist." }, { status: 404 });
  }

  return json({ ok: true, campaign: created }, { status: 201 });
}
