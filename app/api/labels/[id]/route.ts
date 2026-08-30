import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import {
  deleteLabel,
  isLabelColor,
  normaliseLabelHex,
  normaliseLabelName,
  updateLabel,
} from "@/lib/labels";

/**
 * PATCH  /api/labels/:id  → rename / recolour. Body: { name?, color? }
 * DELETE /api/labels/:id  → remove it (and its assignments, via cascade)
 *
 * Both filter on (id, workspace_id) in the mutating statement, so an id from
 * another tenant matches zero rows and comes back as a 404 rather than
 * touching anything.
 */

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/labels/[id]">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const labelId = Number((await ctx.params).id);
  if (!Number.isInteger(labelId)) {
    return json({ error: "Invalid label id" }, { status: 400 });
  }

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

  const patch: {
    name?: string;
    color?: "tag_a" | "tag_b" | "tag_c";
    colorHex?: string | null;
  } = {};
  if (body.name !== undefined) {
    const name = normaliseLabelName(body.name);
    if (!name) return json({ error: "A label needs a name." }, { status: 400 });
    patch.name = name;
  }
  if (body.color !== undefined) {
    if (!isLabelColor(body.color)) {
      return json({ error: "Unknown label colour." }, { status: 400 });
    }
    patch.color = body.color;
  }
  /*
   * Explicit null CLEARS the picked colour and returns the label to its theme
   * token — that is what pressing one of the three presets sends. Undefined
   * leaves it alone. The two are different requests and must not collapse into
   * each other, or choosing a preset would appear to do nothing.
   */
  if (body.colorHex !== undefined) {
    patch.colorHex = body.colorHex === null ? null : normaliseLabelHex(body.colorHex);
  }
  if (
    patch.name === undefined &&
    patch.color === undefined &&
    patch.colorHex === undefined
  ) {
    return json({ error: "Nothing to change." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  try {
    const updated = await updateLabel(workspace.id, labelId, patch);
    if (!updated) return json({ error: "Not found" }, { status: 404 });
    return json({
      ok: true,
      label: {
        id: updated.id,
        name: updated.name,
        color: updated.color,
        colorHex: updated.colorHex,
      },
    });
  } catch {
    // The only constraint that can bite is labels_workspace_name_idx.
    return json(
      { error: "You already have a label with that name." },
      { status: 409 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/labels/[id]">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const labelId = Number((await ctx.params).id);
  if (!Number.isInteger(labelId)) {
    return json({ error: "Invalid label id" }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const removed = await deleteLabel(workspace.id, labelId);
  if (!removed) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true });
}
