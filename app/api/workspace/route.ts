import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { updateWorkspace } from "@/lib/data";
import { THEMES } from "@/lib/theme";

/**
 * PATCH /api/workspace  (authed)
 * Body: { name?, accent? } — updates the caller's own workspace.
 * (sendingEmail was removed: replies always send from our verified domain.)
 */
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    accent?: string;
    legalName?: string;
    postalAddress?: string;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const patch: {
    name?: string;
    accent?: string;
    legalName?: string | null;
    postalAddress?: string | null;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim().slice(0, 80);
  }

  // The CAN-SPAM identity. Both accept "" as an explicit CLEAR, which is why
  // they are not guarded by a truthiness check the way `name` is above: a
  // client who realises they typed the wrong address must be able to remove it,
  // and an address that cannot be removed is one that keeps going out.
  // Clearing the postal address stops that workspace sending — which is the
  // correct consequence, not a side effect to design around.
  if (typeof body.legalName === "string") {
    const trimmed = body.legalName.trim().slice(0, 200);
    patch.legalName = trimmed || null;
  }
  if (typeof body.postalAddress === "string") {
    const trimmed = body.postalAddress.trim().slice(0, 500);
    patch.postalAddress = trimmed || null;
  }
  if (typeof body.accent === "string") {
    // The column is still named `accent`; since the pivot it stores a theme key.
    // Renaming it needs a migration — tracked with the design-system task.
    if (!THEMES.some((t) => t.key === body.accent)) {
      return json({ error: "Unknown theme." }, { status: 400 });
    }
    patch.accent = body.accent;
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: "Nothing to update." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }
  const updated = await updateWorkspace(workspace.id, patch);
  return json({ ok: true, workspace: updated });
}
