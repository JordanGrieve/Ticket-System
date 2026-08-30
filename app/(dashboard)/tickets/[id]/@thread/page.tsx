import { notFound, redirect } from "next/navigation";
import Thread from "@/components/mail/Thread";
import { currentImpersonation, resolveViewer } from "@/lib/viewer";
import { recordImpersonationRead } from "@/lib/impersonation-reads";
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
import {
  archiveTicketAction,
  unarchiveTicketAction,
  snoozeTicketAction,
  unsnoozeTicketAction,
} from "../snooze-actions";
import { isSnoozedNow, describeWakeIn } from "@/lib/snooze";
import { gmailSearchUrl, canOpenInMailClient } from "@/lib/mail-client-link";

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

  /*
    If a Postbox operator is reading this, record WHICH record they opened.

    After the notFound() above, deliberately: a request for a ticket that does
    not exist in this workspace is not access to anything, and logging it would
    fill a client's access log with entries for records they never had.

    Only ever fires during an impersonation — currentImpersonation() is null
    for a client's own staff, and logging their reads of their own inbox is a
    separate question nobody has asked for. See db/schema.ts.

    Not awaited in a way that can break the page: recordImpersonationRead
    swallows its own errors, because a failure to log must not stop an operator
    seeing the ticket they are in the middle of helping somebody with.
  */
  const impersonation = await currentImpersonation();
  if (impersonation?.session) {
    await recordImpersonationRead(impersonation.session.id, ticket.id);
  }

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
      archivedAt={
        ticket.archivedAt ? new Date(ticket.archivedAt).toISOString() : null
      }
      /*
        Passed only while the ticket is ACTUALLY still hidden.

        The column keeps its value after the wake time — that is what lets a
        ticket come back with nothing having run — so handing the raw value
        down would have the thread claim "Snoozed" about a ticket that is
        already back in the inbox. Deciding here also keeps the decision on one
        side of the network: <Thread> does a null check, never a clock
        comparison, so the banner cannot appear on the server and vanish on
        hydration.
      */
      snoozedUntil={
        isSnoozedNow(ticket.snoozedUntil, now)
          ? (ticket.snoozedUntil as Date).toISOString()
          : null
      }
      /* Relative, so it carries no timezone and is safe to compute here. */
      wakeIn={describeWakeIn(ticket.snoozedUntil, now)}
      /*
        The link out to the customer's own mailbox, or null.

        Derived from the FIRST INBOUND message, because that is the one that
        actually landed in their Gmail — a later reply in the same thread has
        its own id, and ours have ids we minted rather than ones Gmail knows.

        Null far more often than not, and deliberately so: contact-form tickets
        were never emails, and every message in development has a null
        message_id. <Thread> renders nothing when this is null rather than
        showing a control that finds nothing.
      */
      openInMailUrl={(() => {
        const firstInbound = messages.find((m) => m.direction === "inbound");
        if (
          !firstInbound ||
          !canOpenInMailClient({
            source: ticket.source,
            messageId: firstInbound.messageId,
          })
        ) {
          return null;
        }
        return gmailSearchUrl(firstInbound.messageId);
      })()}
      archiveTicket={archiveTicketAction}
      unarchiveTicket={unarchiveTicketAction}
      snoozeTicket={snoozeTicketAction}
      unsnoozeTicket={unsnoozeTicketAction}
      backHref={backHref}
      starred={personal.starred}
      unread={personal.unread}
      labels={personal.labels}
      allLabels={allLabels}
      canPersonalise={agentId !== null}
    />
  );
}
