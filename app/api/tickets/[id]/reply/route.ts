import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { getTicket, getMessages, addMessage } from "@/lib/data";
import { activeWorkspace } from "@/lib/viewer";
import { sendReplyEmail } from "@/lib/email";
import { buildReplyTo } from "@/lib/tickets";
import { EMAIL_FROM_ADDRESS } from "@/lib/config";

/**
 * POST /api/tickets/:id/reply  (authed)
 * Body: { message }
 * Sends a real email from the workspace's address with a per-ticket Reply-To,
 * then saves an outbound message and nudges the ticket to "in progress".
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/tickets/[id]/reply">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const ticketId = Number((await ctx.params).id);
  if (!Number.isInteger(ticketId)) {
    return json({ error: "Invalid ticket id" }, { status: 400 });
  }

  let body: { message?: string };
  try {
    body = (await req.json()) as { message?: string };
  } catch {
    body = {};
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return json({ error: "Message is required." }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }
  const ticket = await getTicket(workspace.id, ticketId);
  if (!ticket) return json({ error: "Not found" }, { status: 404 });

  // Threading: our own Message-ID for this send, In-Reply-To pointing at the
  // latest message in the conversation, References carrying the chain — so
  // the customer's mail client groups everything into one thread.
  const history = await getMessages(ticket.id);
  const chain = history
    .map((m) => m.messageId)
    .filter((id): id is string => !!id);
  const newMessageId = `<pb-${crypto.randomUUID()}@postbox.help>`;

  // Send the email (best-effort — the outbound message is saved regardless so
  // the thread stays accurate even if delivery is misconfigured in dev).
  // From is always our verified domain; the workspace name is the display name.
  const emailResult = await sendReplyEmail({
    from: EMAIL_FROM_ADDRESS,
    fromName: workspace.name,
    to: ticket.customerEmail,
    subject: ticket.subject.startsWith("Re:")
      ? ticket.subject
      : `Re: ${ticket.subject}`,
    text: message,
    replyTo: buildReplyTo(ticket.id),
    threading: {
      messageId: newMessageId,
      inReplyTo: chain.at(-1),
      // Keep the header a sane size on long tickets: first + last few.
      references: chain.length > 8 ? [chain[0], ...chain.slice(-7)] : chain,
    },
  });

  const saved = await addMessage({
    ticketId: ticket.id,
    direction: "outbound",
    body: message,
    status: ticket.status === "closed" ? "closed" : "in_progress",
    messageId: newMessageId,
  });

  return json(
    {
      ok: true,
      message: saved,
      emailSent: emailResult.sent,
      ...(emailResult.error ? { emailWarning: emailResult.error } : {}),
    },
    { status: 201 },
  );
}
