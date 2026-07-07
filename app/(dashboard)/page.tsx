import Inbox from "@/components/Inbox";
import { resolveWorkspace } from "@/lib/workspace";
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

  const { workspace } = await resolveWorkspace();
  const rows = await listTickets(workspace.id);
  const now = new Date();
  const tickets = rows.map((t) => toTicketDTO(t, now));

  return <Inbox tickets={tickets} folder={view} />;
}
