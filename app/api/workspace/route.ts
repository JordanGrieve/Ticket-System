import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { updateWorkspace } from "@/lib/data";
import { ACCENT_SCHEMES } from "@/lib/theme";

/**
 * PATCH /api/workspace  (authed)
 * Body: { name?, accent? } — updates the caller's own workspace.
 * (sendingEmail was removed: replies always send from our verified domain.)
 */
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; accent?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const patch: { name?: string; accent?: string } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim().slice(0, 80);
  }
  if (typeof body.accent === "string") {
    if (!ACCENT_SCHEMES[body.accent]) {
      return json({ error: "Unknown accent scheme." }, { status: 400 });
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
