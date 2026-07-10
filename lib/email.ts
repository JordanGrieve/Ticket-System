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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Branded HTML version of the invite (inline styles only — email clients). */
function inviteHtml(input: {
  businessName: string;
  to: string;
  signUpUrl: string;
}): string {
  const business = escapeHtml(input.businessName);
  const email = escapeHtml(input.to);
  const url = escapeHtml(input.signUpUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f4;">
    <div style="display:none;max-height:0;overflow:hidden;">Your ${business} support inbox is ready — sign up to start replying to customers.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr><td style="padding:0 8px 18px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="width:34px;height:34px;background:#d6552f;border-radius:9px;text-align:center;vertical-align:middle;font:800 18px Arial,sans-serif;color:#ffffff;">p</td>
              <td style="padding-left:10px;font:700 19px Arial,sans-serif;color:#26221d;">postbox</td>
            </tr></table>
          </td></tr>
          <tr><td style="background:#ffffff;border:1px solid #e7e1d7;border-radius:16px;padding:32px;">
            <h1 style="margin:0 0 14px;font:700 21px/1.35 Arial,sans-serif;color:#26221d;">Your ${business} support inbox is ready</h1>
            <p style="margin:0 0 18px;font:400 14.5px/1.65 Arial,sans-serif;color:#5f594f;">
              A support inbox has been set up for <b style="color:#26221d;">${business}</b> on Postbox —
              a simple place where your website&rsquo;s contact-form messages and customer emails
              become tickets you can reply to.
            </p>
            <p style="margin:0 0 8px;font:400 14.5px/1.65 Arial,sans-serif;color:#5f594f;">
              Sign up using <b>this email address</b> — that&rsquo;s how your account connects to your inbox:
            </p>
            <p style="margin:0 0 24px;">
              <span style="display:inline-block;background:#f9e7de;border:1px solid #f1dacd;border-radius:8px;padding:8px 14px;font:600 14px Arial,sans-serif;color:#ab441f;">${email}</span>
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="background:#d6552f;border-radius:10px;">
                <a href="${url}" style="display:inline-block;padding:13px 26px;font:600 15px Arial,sans-serif;color:#ffffff;text-decoration:none;">Set up your inbox &rarr;</a>
              </td>
            </tr></table>
            <p style="margin:26px 0 0;font:400 13px/1.6 Arial,sans-serif;color:#a49a89;">
              Any questions, just reply to this email.
            </p>
          </td></tr>
          <tr><td style="padding:18px 8px 0;font:400 12px Arial,sans-serif;color:#b3a999;">
            &mdash; Postbox &middot; postbox.help
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
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
    html: inviteHtml(input),
    // Plain-text fallback for clients that don't render HTML.
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
