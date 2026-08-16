import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import {
  getWorkspaceAgentId,
  markTicketRead,
  markTicketUnread,
} from "@/lib/data";
import { activeWorkspace } from "@/lib/viewer";

/**
 * POST /api/tickets/:id/read  (authed)
 * Body: { read: boolean }
 *
 * Read state is per agent. `read: true` stamps last_read_at = now();
 * `read: false` deletes the receipt, which is what puts the ticket back in the
 * unread pile (unread = "an inbound message newer than my receipt").
 *
 * This is a POST from the thread rather than a write during page render on
 * purpose: rendering is a GET that Next may run for a prefetch, and hovering a
 * link in the list must not mark mail as read.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/tickets/[id]/read">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const ticketId = Number((await ctx.params).id);
  if (!Number.isInteger(ticketId)) {
    return json({ error: "Invalid ticket id" }, { status: 400 });
  }

  let body: { read?: unknown };
  try {
    body = (await req.json()) as { read?: unknown };
  } catch {
    body = {};
  }
  const read = body.read === undefined ? true : body.read;
  if (typeof read !== "boolean") {
    return json({ error: "read must be a boolean." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const agentId = await getWorkspaceAgentId(workspace.id, userId);
  if (agentId === null) {
    // A super-admin has no agent row here, so there is nothing to mark. This
    // is not an error — the thread calls this on open — so say so quietly.
    return json({ ok: true, tracked: false, read: null });
  }

  const ok = read
    ? await markTicketRead(workspace.id, ticketId, agentId)
    : await markTicketUnread(workspace.id, ticketId, agentId);
  if (!ok) return json({ error: "Not found" }, { status: 404 });

  return json({ ok: true, tracked: true, read });
}
