import { notFound } from "next/navigation";
import TicketThread from "@/components/TicketThread";
import { resolveWorkspace } from "@/lib/workspace";
import { getTicket, getMessages } from "@/lib/data";
import { toTicketDTO, toMessageDTO } from "@/lib/serialize";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ticketId = Number((await params).id);
  if (!Number.isInteger(ticketId)) notFound();

  const { workspace, agent } = await resolveWorkspace();
  const ticket = await getTicket(workspace.id, ticketId);
  if (!ticket) notFound();

  const messages = await getMessages(ticket.id);

  return (
    <TicketThread
      ticket={toTicketDTO(ticket)}
      messages={messages.map(toMessageDTO)}
      fromAddress={workspace.sendingEmail}
      ownerLabel={agent.email}
    />
  );
}
