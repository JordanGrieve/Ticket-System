import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import {
  createLabel,
  isLabelColor,
  normaliseLabelHex,
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

  let body: { name?: unknown; color?: unknown; colorHex?: unknown };
  try {
    body = (await req.json()) as {
      name?: unknown;
      color?: unknown;
      colorHex?: unknown;
    };
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

  /*
   * A picked colour is OPTIONAL and silently dropped if it is not six hex
   * digits — see normaliseLabelHex. This value ends up in a CSS custom
   * property on the element, so it is the one field on a label that could
   * carry something other than a colour into a style attribute; refusing
   * anything else is cheaper than sanitising it later. Falling back to the
   * token means a rejected value still renders a perfectly good label.
   */
  const colorHex = normaliseLabelHex(body.colorHex);

  const created = await createLabel(workspace.id, name, color, colorHex);
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
        colorHex: created.colorHex,
        ticketCount: 0,
      },
    },
    { status: 201 },
  );
}
