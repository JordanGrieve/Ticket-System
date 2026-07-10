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

/**
 * Invitation sent when an admin creates a client workspace. Tells the client
 * to sign up WITH THIS EMAIL (the invite is claimed by email match).
 * Reply-To is the inviting admin, so questions come back to a human.
 */
export async function sendInviteEmail(input: {
  to: string;
  businessName: string;
  signUpUrl: string;
  from: string;
  inviterEmail: string;
}): Promise<SendResult> {
  if (!hasKey()) {
    console.warn("[email] RESEND_API_KEY not configured — skipping invite.");
    return { sent: false, error: "Email sending is not configured." };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: `Postbox <${input.from}>`,
    to: [input.to],
    subject: `Your ${input.businessName} support inbox is ready`,
    text: `Hi,

A support inbox has been set up for ${input.businessName} on Postbox — a simple place where your website's contact-form messages and customer emails become tickets you can reply to.

To access it:

1. Go to ${input.signUpUrl}
2. Sign up using this email address (${input.to}) — that's how your account connects to your inbox.

That's it. Any questions, just reply to this email.

— Postbox`,
    replyTo: input.inviterEmail,
  });

  if (error) {
    console.error("[email] invite send failed:", error);
    return { sent: false, error: error.message };
  }
  return { sent: true, id: data?.id };
}
