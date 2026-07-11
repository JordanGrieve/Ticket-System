import { redirect } from "next/navigation";
import Inbox from "@/components/Inbox";
import { resolveViewer } from "@/lib/viewer";
import { listTickets } from "@/lib/data";
import { toTicketDTO } from "@/lib/serialize";

type Folder = "inbox" | "all" | "closed";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder } = await searchParams;
  const view: Folder =
    folder === "all" || folder === "closed" ? folder : "inbox";

  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const rows = await listTickets(viewer.workspace.id);
  const now = new Date();
  const tickets = rows.map((t) => toTicketDTO(t, now));

  return <Inbox tickets={tickets} folder={view} />;
}
