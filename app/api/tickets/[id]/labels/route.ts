import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { labelsForTicket, setTicketLabel } from "@/lib/labels";

/**
 * POST /api/tickets/:id/labels  (authed)
 * Body: { labelId: number, on: boolean }
 *
 * Labels are a workspace-level fact, not a personal one, so this needs no
 * agent id — a super-admin acting inside a client can label its tickets.
 * setTicketLabel requires the ticket AND the label to belong to the active
 * workspace, in the mutating statement itself.
 *
 * Responds with the ticket's full label set so the client never has to guess
 * what the server ended up with.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/tickets/[id]/labels">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const ticketId = Number((await ctx.params).id);
  if (!Number.isInteger(ticketId)) {
    return json({ error: "Invalid ticket id" }, { status: 400 });
  }

  let body: { labelId?: unknown; on?: unknown };
  try {
    body = (await req.json()) as { labelId?: unknown; on?: unknown };
  } catch {
    body = {};
  }
  const labelId = Number(body.labelId);
  if (!Number.isInteger(labelId)) {
    return json({ error: "labelId must be an integer." }, { status: 400 });
  }
  if (typeof body.on !== "boolean") {
    return json({ error: "on must be a boolean." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const result = await setTicketLabel(
    workspace.id,
    ticketId,
    labelId,
    body.on,
  );
  if (result === null) return json({ error: "Not found" }, { status: 404 });

  const labels = await labelsForTicket(workspace.id, ticketId);
  return json({ ok: true, labels });
}
