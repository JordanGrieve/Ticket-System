import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { getWorkspaceAgentId, setTicketStar } from "@/lib/data";
import { activeWorkspace } from "@/lib/viewer";

/**
 * POST /api/tickets/:id/star  (authed)
 * Body: { starred: boolean }
 *
 * Starring is per agent. The star row is written with the workspace predicate
 * inside the statement (see setTicketStar), and the agent id is resolved
 * against the SAME workspace, so neither half can be borrowed from another
 * tenant by guessing an id.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/tickets/[id]/star">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const ticketId = Number((await ctx.params).id);
  if (!Number.isInteger(ticketId)) {
    return json({ error: "Invalid ticket id" }, { status: 400 });
  }

  let body: { starred?: unknown };
  try {
    body = (await req.json()) as { starred?: unknown };
  } catch {
    body = {};
  }
  if (typeof body.starred !== "boolean") {
    return json({ error: "starred must be a boolean." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const agentId = await getWorkspaceAgentId(workspace.id, userId);
  if (agentId === null) {
    // A super-admin viewing a client. There is no agent row that could own the
    // star, and quietly starring it as somebody else would be worse.
    return json(
      { error: "Stars belong to an agent in this workspace." },
      { status: 403 },
    );
  }

  const starred = await setTicketStar(
    workspace.id,
    ticketId,
    agentId,
    body.starred,
  );
  if (starred === null) return json({ error: "Not found" }, { status: 404 });

  return json({ ok: true, starred });
}
