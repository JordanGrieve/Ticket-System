import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { listTickets } from "@/lib/data";
import { activeWorkspace } from "@/lib/viewer";
import type { TicketSource, TicketStatus } from "@/db/schema";

/**
 * GET /api/tickets — authed list for the signed-in user's workspace.
 * Optional query filters: ?source=order&status=open&q=text
 * Always scoped to the caller's workspace_id.
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }
  const all = await listTickets(workspace.id);

  const url = new URL(req.url);
  const source = url.searchParams.get("source") as TicketSource | "all" | null;
  const status = url.searchParams.get("status") as TicketStatus | "all" | null;
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const filtered = all.filter((t) => {
    if (source && source !== "all" && t.source !== source) return false;
    if (status && status !== "all" && t.status !== status) return false;
    if (
      q &&
      !(
        t.customerName.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.orderId ?? "").toLowerCase().includes(q)
      )
    )
      return false;
    return true;
  });

  return json({ tickets: filtered });
}
