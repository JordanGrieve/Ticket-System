import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { setTicketStatus } from "@/lib/data";
import { activeWorkspace } from "@/lib/viewer";
import type { TicketStatus } from "@/db/schema";

const VALID: TicketStatus[] = ["open", "in_progress", "closed"];

/**
 * PATCH /api/tickets/:id/status  (authed)
 * Body: { status: "open" | "in_progress" | "closed" }
 */
export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/tickets/[id]/status">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const ticketId = Number((await ctx.params).id);
  if (!Number.isInteger(ticketId)) {
    return json({ error: "Invalid ticket id" }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    body = {};
  }
  const status = body.status as TicketStatus | undefined;
  if (!status || !VALID.includes(status)) {
    return json(
      { error: `status must be one of: ${VALID.join(", ")}` },
      { status: 400 },
    );
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }
  const updated = await setTicketStatus(workspace.id, ticketId, status);
  if (!updated) return json({ error: "Not found" }, { status: 404 });

  return json({ ok: true, ticket: updated });
}
