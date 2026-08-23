import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { exportWorkspaceData } from "@/lib/data";
import { rateLimitDurable } from "@/lib/rate-limit-store";

/**
 * GET /api/workspace/export  (authed)
 *
 * Downloads everything the workspace holds about its customers as JSON —
 * the self-service half of the data-portability promise in /privacy.
 *
 * Scoped to the caller's active workspace, never a workspace id from the
 * request, so an admin acting within a client exports that client and
 * nothing else.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  // An export reads every ticket, message and contact the workspace owns.
  // Cheap at pilot size, but it is the heaviest query in the app, so it gets
  // a lower ceiling than the reply endpoint.
  const limit = await rateLimitDurable(`export:${workspace.id}`, { max: 5 });
  if (!limit.ok) {
    return json(
      { error: "Too many exports. Try again in a minute." },
      { status: 429 },
    );
  }

  const data = await exportWorkspaceData(workspace.id);
  if (!data) return json({ error: "Not found" }, { status: 404 });

  // Slugged so the filename can't smuggle quotes or newlines into the header.
  const slug =
    workspace.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace";
  const date = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="postbox-${slug}-${date}.json"`,
      // Contains customer PII — never let a shared cache hold onto it.
      "cache-control": "no-store, private",
    },
  });
}
