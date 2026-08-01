import { redirect } from "next/navigation";
import Inbox from "@/components/Inbox";
import { resolveViewer } from "@/lib/viewer";
import {
  countTickets,
  listTicketsPage,
  TICKETS_PAGE_SIZE,
  type TicketFolder,
} from "@/lib/data";
import { toTicketDTO } from "@/lib/serialize";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; page?: string }>;
}) {
  const { folder, page: pageParam } = await searchParams;
  const view: TicketFolder =
    folder === "all" || folder === "closed" ? folder : "inbox";
  const page = Math.max(1, Number(pageParam) || 1);

  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");

  const [counts, rows] = await Promise.all([
    countTickets(viewer.workspace.id),
    listTicketsPage(viewer.workspace.id, view, page),
  ]);
  const total = counts[view];
  const pageCount = Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE));

  const now = new Date();
  const tickets = rows.map((t) => toTicketDTO(t, now));

  return (
    <Inbox
      tickets={tickets}
      folder={view}
      counts={counts}
      page={Math.min(page, pageCount)}
      pageCount={pageCount}
    />
  );
}
