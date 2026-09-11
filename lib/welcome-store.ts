import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { welcomeEmails, workspaces, type WelcomeEmail } from "@/db/schema";
import { APP_URL, EMAIL_FROM_ADDRESS } from "./config";
import { sendReplyEmail } from "./email";
import {
  listUnsubscribeHeaders,
  mailableSender,
  NO_BRAND,
  unsubscribeUrl,
  type Brand,
} from "./newsletter";
import { resolveSigningSecret } from "./subscribe-store";
import { suppressAddress } from "./suppressions";
import {
  decodeWelcomeUnsubToken,
  DEFAULT_WELCOME_BODY,
  DEFAULT_WELCOME_SUBJECT,
  encodeWelcomeUnsubToken,
  renderWelcome,
} from "./welcome";

/**
 * The welcome email — database reads and the send. lib/welcome.ts is the pure
 * half.
 *
 * ── WHY IT GOES OUT THROUGH THE TRANSACTIONAL SENDER ──
 * Campaigns go through SES, which is still sandboxed and inert. This goes
 * through the same Resend path as the confirmation email that immediately
 * precedes it, which means it actually reaches people today — and a welcome
 * that arrives a fortnight after the confirmation it thanks you for is worse
 * than none.
 *
 * It is one message, to one person, caused by that person clicking a link
 * seconds earlier. That is transactional-shaped delivery even though the
 * CONTENT is marketing, and it is the single least likely message in email
 * marketing to be reported as spam. It still carries the postal address and
 * the unsubscribe link — see lib/welcome.ts — because the content is what
 * decides the legal obligation, not the trigger.
 *
 * When campaigns move to a verified marketing domain, this should move with
 * them. Until then the choice is "send it through the live path" or "do not
 * send it", and the second one is what the product already did.
 */

// ── Config ───────────────────────────────────────────────────────

export type WelcomeConfig = {
  enabled: boolean;
  subject: string;
  body: string;
};

/** What a workspace that has never opened the screen should be shown. */
export const DEFAULT_WELCOME: WelcomeConfig = {
  enabled: false,
  subject: DEFAULT_WELCOME_SUBJECT,
  body: DEFAULT_WELCOME_BODY,
};

/**
 * The stored row, or null when there is none.
 *
 * Null and "disabled" are deliberately distinguishable: the settings screen
 * shows the defaults as a starting point for the first case, and what they
 * actually saved for the second.
 */
export async function getWelcomeEmail(
  workspaceId: number,
): Promise<WelcomeEmail | null> {
  const [row] = await db
    .select()
    .from(welcomeEmails)
    .where(eq(welcomeEmails.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

/**
 * Create or replace this workspace's welcome email.
 *
 * The workspace predicate is the conflict target, so a concurrent save cannot
 * produce two rows — `welcome_emails_workspace_idx` is unique.
 */
export async function upsertWelcomeEmail(
  workspaceId: number,
  config: WelcomeConfig,
): Promise<WelcomeEmail> {
  const [row] = await db
    .insert(welcomeEmails)
    .values({ workspaceId, ...config })
    .onConflictDoUpdate({
      target: welcomeEmails.workspaceId,
      set: { ...config, updatedAt: new Date() },
    })
    .returning();
  // The insert either inserted or updated; a missing row here would mean the
  // unique index is gone, which is not a case to paper over.
  if (!row) throw new Error("welcome email upsert returned nothing");
  return row;
}

// ── The send ─────────────────────────────────────────────────────

export type WelcomeSendResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "not_configured"
        | "disabled"
        | "no_postal_address"
        | "no_secret"
        | "send_failed";
    };

/**
 * Send the welcome, if this workspace has one turned on.
 *
 * BEST EFFORT, and the caller must not vary its HTTP response on the result —
 * same rule as the confirmation email. The subscription is already recorded;
 * a welcome that fails to send is a missing nicety, not a failed signup, and
 * reporting it to the browser would tell a prober whether an address is on a
 * list.
 *
 * Every refusal is named rather than collapsed into a boolean, because
 * "disabled" and "no postal address" need very different things doing about
 * them and the log line is the only place anyone will see the difference.
 */
export async function sendWelcomeEmail(input: {
  workspaceId: number;
  email: string;
  name: string | null;
}): Promise<WelcomeSendResult> {
  const config = await getWelcomeEmail(input.workspaceId);
  if (!config) return { sent: false, reason: "not_configured" };
  if (!config.enabled) return { sent: false, reason: "disabled" };

  const [ws] = await db
    .select({
      name: workspaces.name,
      inboundEmail: workspaces.inboundEmail,
      legalName: workspaces.legalName,
      postalAddress: workspaces.postalAddress,
      brandAccentHex: workspaces.brandAccentHex,
      brandSignOff: workspaces.brandSignOff,
    })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);
  if (!ws) return { sent: false, reason: "not_configured" };

  // The same gate a campaign gets, for the same reason: marketing mail must
  // carry a real postal address, and inventing one is worse than not sending.
  // Checked here rather than left to renderWelcome's throw so the reason is
  // reportable — a client whose welcome is silently not going out deserves a
  // better answer than a stack trace in a log.
  const sender = mailableSender({
    workspaceName: ws.name,
    legalName: ws.legalName,
    postalAddress: ws.postalAddress,
  });
  if (!sender) return { sent: false, reason: "no_postal_address" };

  const secret = resolveSigningSecret();
  // No secret means no unsubscribe link we could honour, and an unsubscribe
  // link that does not work is the one defect in a marketing email that is
  // never acceptable. Refuse rather than send a dead link.
  if (!secret) return { sent: false, reason: "no_secret" };

  const brand: Brand = {
    ...NO_BRAND,
    accentHex: ws.brandAccentHex,
    signOff: ws.brandSignOff,
  };

  const token = encodeWelcomeUnsubToken(input.workspaceId, input.email, secret);
  const unsubUrl = unsubscribeUrl(APP_URL, token);

  try {
    const rendered = renderWelcome({
      subject: config.subject,
      body: config.body,
      recipient: { email: input.email, name: input.name },
      workspaceName: ws.name,
      unsubscribeUrl: unsubUrl,
      sender,
      brand,
    });

    const result = await sendReplyEmail({
      from: EMAIL_FROM_ADDRESS,
      fromName: ws.name,
      to: input.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      // A reply reaches the client, not us. Somebody answering a welcome
      // email is talking to the business they just subscribed to.
      replyTo: ws.inboundEmail,
      // RFC 8058. Marketing mail without these gets filed by the big
      // providers as mail that makes unsubscribing hard, and the whole point
      // of this message is that it is easy to get out of.
      headers: listUnsubscribeHeaders({ url: unsubUrl }),
    });
    if (!result.sent) {
      console.warn("[welcome] not sent:", result.error);
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (err) {
    // renderWelcome throws on a sender with no address; that is caught above,
    // so reaching here means something else went wrong and the subscription
    // must not be affected by it.
    console.error("[welcome] send failed:", err);
    return { sent: false, reason: "send_failed" };
  }
}

// ── Unsubscribing from a welcome email ───────────────────────────

/**
 * Honour the unsubscribe link in a welcome email.
 *
 * A campaign's link is a random string looked up in `campaign_recipients`;
 * this one is signed and carries its own workspace and address, so the
 * verification IS the lookup. Both end in the same place — a row in
 * `suppressions` and the subscriber marked `unsubscribed` — because a person
 * who opts out has opted out of everything, not of the message they happened
 * to be reading.
 *
 * Returns `matched: false` for a token we did not issue. The caller must
 * answer identically either way: telling a prober that a token was real tells
 * them an address is on a list.
 */
export async function unsubscribeWelcomeToken(
  token: string,
  source: "one_click" | "link",
): Promise<{ matched: boolean }> {
  const secret = resolveSigningSecret();
  if (!secret) return { matched: false };

  const decoded = decodeWelcomeUnsubToken(token, secret);
  if (!decoded.ok) return { matched: false };

  // 'manual' because SuppressionReason has no 'unsubscribe' member; the
  // provenance lives in the note. Adding a member is a schema change, and the
  // existing campaign path records opt-outs the same way, so the two agree.
  await suppressAddress({
    workspaceId: decoded.workspaceId,
    email: decoded.email,
    reason: "manual",
    note:
      source === "one_click"
        ? "One-click unsubscribe (RFC 8058) from the welcome email"
        : "Unsubscribed via the link in the welcome email",
  });
  return { matched: true };
}
