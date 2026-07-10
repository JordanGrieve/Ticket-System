import { notFound, redirect } from "next/navigation";
import TicketThread from "@/components/TicketThread";
import { resolveViewer } from "@/lib/viewer";
import { getTicket, getMessages } from "@/lib/data";
import { toTicketDTO, toMessageDTO } from "@/lib/serialize";
import { EMAIL_FROM_ADDRESS } from "@/lib/config";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ticketId = Number((await params).id);
  if (!Number.isInteger(ticketId)) notFound();

  const viewer = await resolveViewer();
  if (viewer.isAdmin && !viewer.workspace) redirect("/admin");
  const workspace = viewer.workspace!;
  const ownerLabel = viewer.isAdmin ? viewer.email : viewer.agentEmail;

  const ticket = await getTicket(workspace.id, ticketId);
  if (!ticket) notFound();

  const messages = await getMessages(ticket.id);

  return (
    <TicketThread
      ticket={toTicketDTO(ticket)}
      messages={messages.map(toMessageDTO)}
      fromAddress={`${workspace.name} <${EMAIL_FROM_ADDRESS}>`}
      ownerLabel={ownerLabel}
    />
  );
}
