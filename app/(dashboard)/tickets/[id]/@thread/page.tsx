import { notFound, redirect } from "next/navigation";
import Thread from "@/components/mail/Thread";
import { resolveViewer } from "@/lib/viewer";
import { getTicket, getMessages, TICKETS_PAGE_SIZE } from "@/lib/data";
import { listLabels } from "@/lib/labels";
import { toTicketDTO, toMessageDTO } from "@/lib/serialize";
import { EMAIL_FROM_ADDRESS } from "@/lib/config";
import {
  getContactFacts,
  listContactNotes,
  listSharedLinks,
  mailCounts,
  mailFolderTotal,
  parseFolder,
  ticketPersonalState,
  viewerAgentId,
} from "../../../queries";
import {
  addContactNoteAction,
  deleteContactNoteAction,
} from "../note-actions";
import {
  trashTicketAction,
  restoreTicketAction,
} from "../trash-actions";

/**
 * The `@thread` slot: the conversation, plus the contact rail that <Thread>
 * mounts alongside it.
 *
 * This is the only half of /tickets/[id] that skeletons on navigation, which
 * is the whole point of the split — see ../layout.tsx.
 *
 * Unlike the list pane, this component IS async and awaits at the top. That is
 * deliberate: the segment already has something to show while it runs, namely
 * this slot's own loading.tsx, so suspending here costs nothing and keeps
 * `notFound()` ahead of any Suspense boundary inside the slot.
 *
 * It re-derives `folder` / `page` / `label` from searchParams for `backHref`.
 * Slots do receive searchParams (verified against 16.2.10), and the counts it
 * needs come from `mailCounts` / `mailFolderTotal`, which are wrapped in React
 * `cache()` — so sharing them with the list pane costs no extra query.
 */
export default async function TicketThreadSlot({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ folder?: string; page?: string; label?: string }>;
}) {
  const ticketId = Number((await params).id);
  if (!Number.isInteger(ticketId)) notFound();

  const {
    folder: folderParam,
    page: pageParam,
    label: labelParam,
  } = await searchParams;
  const folder = parseFolder(folderParam);
  const page = Math.max(1, Number(pageParam) || 1);
  const labelNum = Number(labelParam);
  const labelId = Number.isInteger(labelNum) && labelNum > 0 ? labelNum : undefined;

  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const ticket = await getTicket(workspace.id, ticketId);
  if (!ticket) notFound();

  const [
    { messages, hasMore },
    counts,
    facts,
    personal,
    allLabels,
    agentId,
    notes,
    links,
  ] = await Promise.all([
    getMessages(ticket.id),
    mailCounts(workspace.id),
    getContactFacts(workspace.id, ticket.customerEmail),
    ticketPersonalState(workspace.id, ticket.id),
    listLabels(workspace.id),
    viewerAgentId(workspace.id),
    // In the Promise.all, not after it: neon-http gives every statement its own
    // HTTP request, so awaiting this separately would add a round trip to
    // opening any thread.
    listContactNotes(workspace.id, ticket.customerEmail),
    listSharedLinks(workspace.id, ticket.customerEmail),
  ]);

  const total =
    labelId === undefined
      ? counts[folder]
      : await mailFolderTotal(workspace.id, folder, labelId);
  const pageCount = Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE));
  const now = new Date();
  const labelQuery = labelId === undefined ? "" : `&label=${labelId}`;
  const backHref = `/inbox?folder=${folder}${labelQuery}&page=${Math.min(page, pageCount)}`;

  return (
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
      notes={notes}
      // Server actions handed down as props: Thread is a client component and
      // must not import the "use server" module itself.
      addNote={addContactNoteAction}
      deleteNote={deleteContactNoteAction}
      links={links}
      deletedAt={ticket.deletedAt ? new Date(ticket.deletedAt).toISOString() : null}
      deletedBy={ticket.deletedBy}
      trashTicket={trashTicketAction}
      restoreTicket={restoreTicketAction}
      backHref={backHref}
      starred={personal.starred}
      unread={personal.unread}
      labels={personal.labels}
      allLabels={allLabels}
      canPersonalise={agentId !== null}
    />
  );
}
