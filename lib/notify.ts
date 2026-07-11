import type { Ticket, Workspace } from "@/db/schema";
import { listAgentEmails } from "./data";
import { sendTicketNotification } from "./email";
import { previewText } from "./tickets";
import { APP_URL, EMAIL_FROM_ADDRESS } from "./config";

/**
 * Tell the workspace's people a customer wrote in. Strictly best-effort:
 * ticket creation must never fail because a notification couldn't send.
 */
export async function notifyWorkspace(opts: {
  workspace: Workspace;
  ticket: Ticket;
  kind: "new" | "reply";
  body: string;
}): Promise<void> {
  try {
    const emails = await listAgentEmails(opts.workspace.id);
    // Never notify the ticket's own customer (owner testing against
    // themselves would email them about their own message).
    const recipients = emails.filter(
      (e) => e !== opts.ticket.customerEmail.toLowerCase(),
    );
    if (recipients.length === 0) return;

    await sendTicketNotification({
      to: recipients,
      workspaceName: opts.workspace.name,
      kind: opts.kind,
      ticketId: opts.ticket.id,
      subject: opts.ticket.subject,
      customerName: opts.ticket.customerName,
      preview: previewText(opts.body, 200),
      ticketUrl: `${APP_URL}/tickets/${opts.ticket.id}`,
      from: EMAIL_FROM_ADDRESS,
    });
  } catch (err) {
    console.error("[notify] failed:", err);
  }
}
