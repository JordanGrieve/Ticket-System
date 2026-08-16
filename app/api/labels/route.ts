import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import {
  createLabel,
  isLabelColor,
  listLabelsWithCounts,
  normaliseLabelName,
} from "@/lib/labels";

/**
 * GET  /api/labels  → this workspace's labels with ticket counts
 * POST /api/labels  → create one. Body: { name: string, color?: LabelColor }
 *
 * Both are scoped to the active workspace. `labels` carries workspace_id, so
 * the filter is direct here; the counts join up to tickets and filter there.
 */

export async function GET() {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  return json({ labels: await listLabelsWithCounts(workspace.id) });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: unknown; color?: unknown };
  try {
    body = (await req.json()) as { name?: unknown; color?: unknown };
  } catch {
    body = {};
  }

  const name = normaliseLabelName(body.name);
  if (!name) return json({ error: "A label needs a name." }, { status: 400 });

  const color = body.color === undefined ? "tag_a" : body.color;
  if (!isLabelColor(color)) {
    return json({ error: "Unknown label colour." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const created = await createLabel(workspace.id, name, color);
  if (!created) {
    // Unique on (workspace_id, name) — another tenant's "Urgent" is fine.
    return json(
      { error: `You already have a label called “${name}”.` },
      { status: 409 },
    );
  }

  return json(
    {
      ok: true,
      label: {
        id: created.id,
        name: created.name,
        color: created.color,
        ticketCount: 0,
      },
    },
    { status: 201 },
  );
}
