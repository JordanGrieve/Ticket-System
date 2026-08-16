import { notFound, redirect } from "next/navigation";
import MessageList from "@/components/mail/MessageList";
import Thread from "@/components/mail/Thread";
import { resolveViewer } from "@/lib/viewer";
import { getTicket, getMessages, TICKETS_PAGE_SIZE } from "@/lib/data";
import { toTicketDTO, toMessageDTO } from "@/lib/serialize";
import { EMAIL_FROM_ADDRESS } from "@/lib/config";
import {
  getContactFacts,
  listMailPage,
  mailCounts,
  parseFolder,
  toMailRow,
} from "../../queries";

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // The list pane is rendered here too, so the desktop keeps both panes while
  // you move between threads. It needs to know which page of which folder you
  // came from — the list rows carry that through in the link.
  searchParams: Promise<{ folder?: string; page?: string }>;
}) {
  const ticketId = Number((await params).id);
  if (!Number.isInteger(ticketId)) notFound();

  const { folder: folderParam, page: pageParam } = await searchParams;
  const folder = parseFolder(folderParam);
  const page = Math.max(1, Number(pageParam) || 1);

  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const ticket = await getTicket(workspace.id, ticketId);
  if (!ticket) notFound();

  const [{ messages, hasMore }, counts, rows, facts] = await Promise.all([
    getMessages(ticket.id),
    mailCounts(workspace.id),
    listMailPage(workspace.id, folder, page),
    getContactFacts(workspace.id, ticket.customerEmail),
  ]);

  const total = counts[folder];
  const pageCount = Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE));
  const now = new Date();
  const backHref = `/inbox?folder=${folder}&page=${Math.min(page, pageCount)}`;

  return (
    <>
      <MessageList
        rows={rows.map((r) => toMailRow(r, now))}
        folder={folder}
        page={Math.min(page, pageCount)}
        pageCount={pageCount}
        total={total}
        selectedId={ticket.id}
        hideOnMobile
      />
      <Thread
        ticket={toTicketDTO(ticket, now)}
        messages={messages.map(toMessageDTO)}
        hasOlderMessages={hasMore}
        fromAddress={`${workspace.name} <${EMAIL_FROM_ADDRESS}>`}
        contact={{
          name: ticket.customerName,
          email: ticket.customerEmail,
          firstSeenIso: facts.firstSeenIso,
          ticketCount: facts.ticketCount,
        }}
        backHref={backHref}
      />
    </>
  );
}
