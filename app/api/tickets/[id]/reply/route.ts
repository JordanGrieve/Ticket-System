import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { getTicket, addMessage } from "@/lib/data";
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
  });

  const saved = await addMessage({
    ticketId: ticket.id,
    direction: "outbound",
    body: message,
    status: ticket.status === "closed" ? "closed" : "in_progress",
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
