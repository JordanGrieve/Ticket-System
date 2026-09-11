import { Resend } from "resend";
import { recordUsage } from "./usage-store";
import { isProviderRateLimit } from "./email-quota";
import { recordTransactionalSend } from "./email-quota-store";

/**
 * Resend wrapper. Replies are sent as real email FROM the workspace's
 * configured sending address, with a per-ticket Reply-To so the customer's
 * response threads back into the same ticket.
 *
 * In development without a real RESEND_API_KEY we skip the network call and
 * report `sent: false` so the dashboard keeps working (the outbound message is
 * still saved by the caller).
 *
 * ── WHY THE USAGE COUNTER LIVES HERE AND NOT IN THE CALLERS ──
 * Ticket replies, notifications, signup confirmations, the welcome email and
 * team invites all send through this module. Metering at each of those means
 * a metering gap every time a sixth is added, and a gap in this counter is a
 * bill we pay and do not charge for. So it is counted here, and the workspace
 * is a parameter. A caller that omits it is asserting "this is not a tenant's
 * mail" — true of exactly one case, an operator inviting somebody into a
 * workspace from the admin console.
 *
 * ── ONE PATH DOES NOT COME THROUGH HERE ──
 * lib/auto-reply-send.ts calls Resend directly, because it needs its own
 * RFC 3834 headers and its own per-ticket reply-to. It counts its own send.
 * A third path must do the same. "Everything goes through lib/email.ts" is
 * very nearly true, and has been false since the auto-reply landed — which is
 * exactly the shape of nearly-true claim that produces an unmetered send.
 *
 * Accepted cost: this module now reaches the database, where before it only
 * reached Resend. Worth it for a count that cannot silently miss a path.
 * `recordUsage` swallows its own errors, so a counter that cannot be written
 * never turns into an email that was not sent.
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
  /**
   * Optional HTML part. Omitted for ticket replies on purpose — those should
   * read as a message from a person, and a styled shell is what makes a reply
   * look like a mailout. The welcome email (lib/welcome-store.ts) sets it,
   * because that one IS a mailout and should look like the newsletter it
   * introduces.
   */
  html?: string;
  replyTo: string;
  /**
   * Email threading. inReplyTo/references must be REAL delivered Message-IDs
   * (the customer's own, or ours learned from their replies) — SES overwrites
   * any Message-ID we set ourselves, so fabricated ids never thread.
   */
  threading?: {
    inReplyTo?: string;
    references?: string[];
  };
  /**
   * Extra headers, merged after the threading ones. `List-Unsubscribe` and
   * `List-Unsubscribe-Post` travel this way: any marketing mail sent through
   * this function needs them, and they are not threading.
   */
  headers?: Record<string, string>;
  /**
   * Whose monthly allowance this spends. Omit only for mail that is not a
   * tenant's — see the header. A successful send without one is invisible to
   * the cap.
   */
  workspaceId?: number;
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

  const headers: Record<string, string> = {};
  if (input.threading?.inReplyTo) {
    headers["In-Reply-To"] = input.threading.inReplyTo;
  }
  if (input.threading?.references?.length) {
    headers["References"] = input.threading.references.join(" ");
  }
  Object.assign(headers, input.headers ?? {});

  const { data, error } = await resend.emails.send({
    from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
    replyTo: input.replyTo,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });

  if (error) {
    /*
      A cap being hit and an address being wrong are opposite problems and
      must not share a log line: one is ours, affects every tenant and
      clears by itself; the other is one customer's and usually does not.
      See isProviderRateLimit.
    */
    if (isProviderRateLimit(error)) {
      console.error(
        "[email] send REFUSED BY THE PROVIDER'S RATE LIMIT — every tenant's transactional mail is affected:",
        error,
      );
    } else {
      console.error("[email] send failed:", error);
    }
    return { sent: false, error: error.message };
  }
  if (input.workspaceId !== undefined) {
    await recordUsage(input.workspaceId, "emails_sent", 1);
  }
  // Platform-wide, not per workspace: the daily ceiling belongs to the shared
  // provider account. See lib/email-quota.ts.
  await recordTransactionalSend();
  return { sent: true, id: data?.id };
}

/**
 * Heads-up to the workspace's people when a customer writes in — a new
 * ticket or a reply on an existing one. Without this, tickets sit unseen
 * until someone happens to open the dashboard.
 */
export async function sendTicketNotification(input: {
  to: string[];
  workspaceName: string;
  kind: "new" | "reply";
  ticketId: number;
  subject: string;
  customerName: string;
  preview: string;
  ticketUrl: string;
  from: string;
  /** Whose allowance this spends. See the header. */
  workspaceId?: number;
}): Promise<SendResult> {
  if (!hasKey() || input.to.length === 0) {
    return { sent: false, error: "Email sending is not configured." };
  }

  const isNew = input.kind === "new";
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: `Postbox <${input.from}>`,
    to: input.to,
    subject: `${isNew ? "New ticket" : "New reply"}: ${input.subject}`,
    text: `${input.customerName} ${isNew ? "opened a new ticket" : "replied to a ticket"} in ${input.workspaceName}:

"${input.preview}"

Reply from your inbox:
${input.ticketUrl}

— Postbox`,
  });

  if (error) {
    /*
      A cap being hit and an address being wrong are opposite problems and
      must not share a log line: one is ours, affects every tenant and
      clears by itself; the other is one customer's and usually does not.
      See isProviderRateLimit.
    */
    if (isProviderRateLimit(error)) {
      console.error(
        "[email] notification send REFUSED BY THE PROVIDER'S RATE LIMIT — every tenant's transactional mail is affected:",
        error,
      );
    } else {
      console.error("[email] notification send failed:", error);
    }
    return { sent: false, error: error.message };
  }
  // Per RECIPIENT, not per call. One API request carrying ten addresses is ten
  // emails on the bill, and a Business workspace with ten people on it spends
  // most of its allowance here rather than on campaigns.
  if (input.workspaceId !== undefined) {
    await recordUsage(input.workspaceId, "emails_sent", input.to.length);
  }
  // One API call, several addresses, several emails against the daily cap.
  for (let i = 0; i < input.to.length; i += 1) await recordTransactionalSend();
  return { sent: true, id: data?.id };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Branded HTML version of the invite (inline styles only — email clients).
 *
 * ── THE COLOURS HERE ARE MEASURED, NOT PICKED ──
 * Every pairing below is asserted in tests/email-colour.test.ts. Three of them
 * failed AA when they were first measured on 6 Sep 2026, in the first email a
 * new client ever receives from Postbox:
 *
 *  - White on the brand orange #d6552f was 4.04:1 — the "Set up your inbox"
 *    button, which is the single action this email exists to produce, and the
 *    logo tile beside it. The ground is now #c14d2a: 4.81:1, and near enough
 *    the same orange that nothing about the design changed.
 *  - #a49a89 at 13px was 2.78:1 on the white card.
 *  - #b3a999 at 12px was 2.19:1 on the page — the worst measured anywhere in
 *    the product.
 *
 * Both greys are now #746d61, which clears on the white card (5.12:1) and on
 * the #faf8f4 page (4.83:1), so the small print does not need two values to
 * keep track of.
 *
 * An email has no cascade and no second chance: whatever hex ships is what a
 * stranger reads. Do not add a colour here without adding it to that test.
 */
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
              <td style="width:34px;height:34px;background:#c14d2a;border-radius:9px;text-align:center;vertical-align:middle;font:800 18px Arial,sans-serif;color:#ffffff;">p</td>
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
              <td style="background:#c14d2a;border-radius:10px;">
                <a href="${url}" style="display:inline-block;padding:13px 26px;font:600 15px Arial,sans-serif;color:#ffffff;text-decoration:none;">Set up your inbox &rarr;</a>
              </td>
            </tr></table>
            <p style="margin:26px 0 0;font:400 13px/1.6 Arial,sans-serif;color:#746d61;">
              Any questions, just reply to this email.
            </p>
          </td></tr>
          <tr><td style="padding:18px 8px 0;font:400 12px Arial,sans-serif;color:#746d61;">
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
    /*
      A cap being hit and an address being wrong are opposite problems and
      must not share a log line: one is ours, affects every tenant and
      clears by itself; the other is one customer's and usually does not.
      See isProviderRateLimit.
    */
    if (isProviderRateLimit(error)) {
      console.error(
        "[email] invite send REFUSED BY THE PROVIDER'S RATE LIMIT — every tenant's transactional mail is affected:",
        error,
      );
    } else {
      console.error("[email] invite send failed:", error);
    }
    return { sent: false, error: error.message };
  }
  await recordTransactionalSend();
  return { sent: true, id: data?.id };
}
