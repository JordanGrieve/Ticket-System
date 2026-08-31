import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace, currentImpersonation } from "@/lib/viewer";
import { recordAdminAction } from "@/lib/admin-audit";
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

  /*
    If a Postbox operator is doing this, record it BEFORE the data is read.

    ── WHY THIS ENDPOINT NEEDS ITS OWN RECORD ──
    Everything else an operator can see, they see one screen at a time, and
    impersonation_reads names the conversations they opened. This hands over
    the whole workspace in a single request — every ticket, every message,
    every contact — and until now it left no trace beyond "somebody was in
    your workspace". A client reading their access log would see a visit with
    no conversations opened, which is true and gives entirely the wrong
    impression of what happened.

    ── BEFORE THE READ, AND FAIL-CLOSED ──
    The opposite choice to impersonation_reads, deliberately. That one is best
    effort because refusing to render a ticket would break the product
    mid-investigation over a decorative row. This is a bulk extraction of a
    client's customer data; if it cannot be recorded, it does not happen. The
    cost of being wrong here is a failed download and a retry.

    Written before the export runs for the same reason lib/admin-audit.ts
    writes before a deletion: an export that dies halfway still moved data
    into somebody's memory, and the log should say it was attempted.

    A CLIENT exporting their own data is not logged — currentImpersonation()
    is null for them. That is portability, not access by us.
  */
  const impersonation = await currentImpersonation();
  if (impersonation) {
    try {
      await recordAdminAction({
        action: "workspace_exported",
        actorAdminId: impersonation.session?.adminId ?? null,
        actorEmail: impersonation.operatorEmail ?? "unknown",
        targetId: workspace.id,
        targetLabel: workspace.name,
      });
    } catch (err) {
      console.error("[export] refusing: could not record the export:", err);
      return json(
        {
          error:
            "Could not record this export in the access log, so it has not " +
            "been produced. Try again.",
        },
        { status: 503 },
      );
    }
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
