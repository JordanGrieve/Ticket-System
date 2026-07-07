import { auth } from "@clerk/nextjs/server";
import { json, isValidEmail } from "@/lib/http";
import { resolveWorkspace } from "@/lib/workspace";
import { updateWorkspace } from "@/lib/data";
import { ACCENT_SCHEMES } from "@/lib/theme";

/**
 * PATCH /api/workspace  (authed)
 * Body: { name?, sendingEmail?, accent? } — updates the caller's own workspace.
 */
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; sendingEmail?: string; accent?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const patch: { name?: string; sendingEmail?: string; accent?: string } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (typeof body.sendingEmail === "string") {
    if (!isValidEmail(body.sendingEmail.trim())) {
      return json({ error: "Invalid reply-from email address." }, { status: 400 });
    }
    patch.sendingEmail = body.sendingEmail.trim();
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

  const { workspace } = await resolveWorkspace();
  const updated = await updateWorkspace(workspace.id, patch);
  return json({ ok: true, workspace: updated });
}
