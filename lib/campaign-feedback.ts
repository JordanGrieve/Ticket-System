import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaignRecipients, campaigns, ticketMessages } from "@/db/schema";
import type { SuppressionReason } from "@/db/schema";
import { suppressAddress } from "./suppressions";
import { recordFeedbackDrop } from "./feedback-log";

/**
 * A bounce or a complaint about a CAMPAIGN, turned into a suppression.
 *
 * ── THE GAP THIS CLOSES ──
 * Every send path in this product could put mail on the wire, and nothing
 * anywhere read the answer back. Campaign feedback reached suppressions only
 * through the SES webhook, SES never got production access, and on
 * 14 Sep 2026 it was deleted — leaving `recordFeedbackDrop` with no caller and
 * a live Resend campaign path with no feedback loop at all.
 *
 * What that costs is not obvious for a week and then very expensive. An
 * address that hard-bounces keeps being mailed every campaign, for ever, and
 * the bounce rate that gets a Resend account suspended is a number the whole
 * platform shares. Repeat complaints are worse: a complaint is a person saying
 * "this is spam" and mailing them again after it is the single most reliable
 * way to lose a sending domain — for every tenant at once, not just the one
 * whose list it was.
 *
 * ── ONE WEBHOOK, TWO KINDS OF MAIL ──
 * Resend posts transactional and campaign events to the same endpoint, and
 * they must be handled differently. A bounced ticket reply is between a
 * business and their own customer; suppressing on it would stop that business
 * emailing somebody with an open enquiry, and `suppressions` is not the place
 * for it — see the note in the webhook. So a campaign bounce is identified by
 * matching the provider's message id to a `campaign_recipients` row, and
 * anything that does not match is left alone.
 *
 * ── TENANCY ──
 * The workspace comes from the campaign the recipient row belongs to. It is
 * never read from the payload: a webhook body is attacker-shaped input, and a
 * workspace id taken from one would let a forged event suppress an address in
 * somebody else's account.
 */

export type CampaignFeedbackEvent = "bounced" | "complained";

export type CampaignFeedbackOutcome =
  | { matched: false }
  | {
      matched: true;
      workspaceId: number;
      email: string;
      /** False when the address was already suppressed for this workspace. */
      suppressed: boolean;
    };

/**
 * Which suppression a feedback event justifies.
 *
 * Pure, and separate from the write, so the mapping can be tested without a
 * database. There are only two campaign feedback events and they are not
 * interchangeable: a hard bounce is a fact about an address, a complaint is a
 * statement by a person. Both stop the mail; only one of them is about the
 * mailbox.
 */
export function suppressionReasonFor(
  event: CampaignFeedbackEvent,
): SuppressionReason {
  return event === "complained" ? "complaint" : "hard_bounce";
}

/**
 * The recipient status a feedback event puts the row in.
 *
 * Mirrors the suppression reason rather than deriving from it, because
 * `campaign_recipients.status` is the per-send log and reads as history: a row
 * that says "complained" is why the report shows one fewer delivered.
 */
function recipientStatusFor(event: CampaignFeedbackEvent) {
  return event === "complained" ? ("complained" as const) : ("bounced" as const);
}

/**
 * Apply a campaign bounce or complaint.
 *
 * ── SUPPRESS FIRST, THEN RECORD ──
 * The suppression is the protective act and the recipient row is bookkeeping,
 * so the order is chosen for what a crash between them leaves behind: an
 * address suppressed with its row still reading "sent" is a report that is
 * slightly wrong, and the reverse is an address we have marked as bounced and
 * will cheerfully mail again next month.
 *
 * Idempotent in both halves. Webhooks are retried and redelivered: the
 * suppression conflicts on (workspace_id, email) and does nothing the second
 * time, and the status write is the same value again.
 */
export async function applyCampaignFeedback(input: {
  providerMessageId: string;
  event: CampaignFeedbackEvent;
  /** The provider's own event name, for the drop log. */
  eventType: string;
  /** The provider's diagnostic, kept on the suppression as evidence. */
  note?: string | null;
}): Promise<CampaignFeedbackOutcome> {
  const providerMessageId = input.providerMessageId.trim();
  if (!providerMessageId) return { matched: false };

  /*
    The recipient row and the workspace that owns it, in one read.

    `campaign_recipients` has no workspace column — it hangs off the campaign —
    so this join is how the tenant is established, and it is the only way it
    is ever established here.
  */
  const [row] = await db
    .select({
      recipientId: campaignRecipients.id,
      email: campaignRecipients.email,
      workspaceId: campaigns.workspaceId,
    })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(eq(campaignRecipients.providerMessageId, providerMessageId))
    .limit(1);

  if (!row) return { matched: false };

  const suppression = await suppressAddress({
    workspaceId: row.workspaceId,
    email: row.email,
    reason: suppressionReasonFor(input.event),
    note: input.note ?? `Resend ${input.eventType}`,
  });

  /*
    The row moves to its terminal status, and only forward.

    The status predicate stops a late "bounced" overwriting a "complained" that
    arrived first — both are terminal and the complaint is the more serious
    fact about that address, so whichever is already there stays.
  */
  await db
    .update(campaignRecipients)
    .set({ status: recipientStatusFor(input.event) })
    .where(
      and(
        eq(campaignRecipients.id, row.recipientId),
        sql`${campaignRecipients.status} NOT IN ('bounced', 'complained')`,
      ),
    );

  return {
    matched: true,
    workspaceId: row.workspaceId,
    email: row.email,
    suppressed: suppression.created,
  };
}

/**
 * Record feedback that could not be attributed to anybody.
 *
 * ── WHY IT CHECKS FOR A TICKET MESSAGE FIRST ──
 * Under SES this endpoint received campaign events only, so "no matching
 * recipient" meant something was wrong. Resend posts BOTH kinds here, and a
 * bounced ticket reply legitimately matches no campaign recipient — logging
 * every one of those as a drop would bury the signal in normal traffic within
 * a day.
 *
 * So a drop is recorded only when the id matches nothing at all: not a
 * campaign recipient, not a ticket message. That is the state that means the
 * provider's ids have stopped being stored, which is the failure worth being
 * able to see — it makes every bounce silently stop suppressing anybody while
 * the reports go on looking healthy.
 */
export async function recordUnattributableFeedback(input: {
  providerMessageId: string | null;
  eventType: string;
}): Promise<void> {
  const id = (input.providerMessageId ?? "").trim();

  if (!id) {
    // No id at all is never normal, whatever kind of mail it was about.
    await recordFeedbackDrop({
      reason: "no_message_id",
      eventType: input.eventType,
      messageId: null,
    });
    return;
  }

  const [known] = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(eq(ticketMessages.providerMessageId, id))
    .limit(1);
  if (known) return;

  await recordFeedbackDrop({
    reason: "unmapped_message_id",
    eventType: input.eventType,
    messageId: id,
  });
}
