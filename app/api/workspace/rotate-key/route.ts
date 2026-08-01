import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { rotateWorkspaceApiKey } from "@/lib/data";
import { generateApiKey } from "@/lib/workspace";

/**
 * POST /api/workspace/rotate-key  (authed)
 * Replaces the workspace's public ingestion key. Any snippet using the old
 * key stops working immediately — callers must re-install afterwards.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const updated = await rotateWorkspaceApiKey(workspace.id, generateApiKey());
  if (!updated) return json({ error: "Not found" }, { status: 404 });

  return json({ ok: true, apiKey: updated.apiKey });
}
