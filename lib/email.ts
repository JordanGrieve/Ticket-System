import { Resend } from "resend";

/**
 * Resend wrapper. Replies are sent as real email FROM the workspace's
 * configured sending address, with a per-ticket Reply-To so the customer's
 * response threads back into the same ticket.
 *
 * In development without a real RESEND_API_KEY we skip the network call and
 * report `sent: false` so the dashboard keeps working (the outbound message is
 * still saved by the caller).
 */

function hasKey(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !!key && key !== "re_placeholder";
}

export type SendResult = { sent: boolean; id?: string; error?: string };

export async function sendReplyEmail(input: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  replyTo: string;
}): Promise<SendResult> {
  if (!hasKey()) {
    console.warn(
      "[email] RESEND_API_KEY not configured — skipping actual send.",
    );
    return { sent: false, error: "Email sending is not configured." };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = input.fromName
    ? `${input.fromName} <${input.from}>`
    : input.from;

  const { data, error } = await resend.emails.send({
    from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
    replyTo: input.replyTo,
  });

  if (error) {
    console.error("[email] send failed:", error);
    return { sent: false, error: error.message };
  }
  return { sent: true, id: data?.id };
}
