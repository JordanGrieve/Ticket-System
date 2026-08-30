import "server-only";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { feedbackDrops } from "@/db/schema";
import type { FeedbackDropReason } from "@/db/schema";

/**
 * Bounces and complaints that reached us and could not be attributed.
 *
 * ── WHY ──
 * The SES webhook drops feedback it cannot map to a `campaign_recipients` row.
 * That is the right call: the alternative is suppressing globally, and one
 * tenant's bounce must never silence an address for another. But the drop only
 * reached `console.warn`, and nobody reads platform logs on a normal day.
 *
 * So a systematic attribution failure is INDISTINGUISHABLE FROM CLEAN SENDING.
 * If a deploy stopped recording provider message ids, every bounce would
 * silently stop suppressing anybody, the campaign reports would look healthy,
 * and the first symptom would be the shared sending domain's reputation
 * falling — months later, affecting every tenant at once.
 *
 * This is the counterpart to lib/ingestion-log.ts, which exists because the
 * same shape of problem — a correct rejection, thrown away — hid a client's
 * broken contact form for six weeks.
 *
 * ── BEST EFFORT, ALWAYS ──
 * Every function swallows its own errors. This is called from a webhook whose
 * 200 tells Amazon the notification was handled; a logging table that turns
 * that into a 500 would make SNS retry, and repeated retries of a bounce we
 * already processed is a worse bug than the one this diagnoses.
 */

/**
 * Record one unattributable feedback event.
 *
 * Upserts a single row per (reason, event_type) with a count — never a row per
 * event. Both columns come from closed sets, so this table has a fixed maximum
 * size of a few rows regardless of volume. That matters during an incident:
 * the moment worth recording is exactly the moment thousands of events arrive,
 * and a row-per-event log would turn a deliverability problem into a database
 * problem at the same instant.
 */
export async function recordFeedbackDrop(input: {
  reason: FeedbackDropReason;
  /** SES notificationType. Free text from the provider, so it is capped. */
  eventType: string;
  /** The id that could not be matched, if there was one. */
  messageId?: string | null;
}): Promise<void> {
  const eventType = (input.eventType || "unknown").trim().slice(0, 40);
  // Capped for the same reason: it is provider-supplied and reaches a column.
  const messageId = (input.messageId ?? "").trim().slice(0, 200) || null;

  try {
    await db
      .insert(feedbackDrops)
      .values({
        reason: input.reason,
        eventType,
        lastMessageId: messageId,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [feedbackDrops.reason, feedbackDrops.eventType],
        set: {
          count: sql`${feedbackDrops.count} + 1`,
          lastSeenAt: sql`now()`,
          /*
             COALESCE so a later event carrying no id does not erase the one
             traceable example we had. An id is the only thing here somebody
             can actually follow up, and losing it to a subsequent blank is
             the kind of small silent regression this file exists to stop.
          */
          lastMessageId: sql`COALESCE(${messageId}, ${feedbackDrops.lastMessageId})`,
        },
      });
  } catch (err) {
    console.error("[feedback-log] could not record a drop:", err);
  }
}

export type FeedbackDropRow = {
  reason: FeedbackDropReason;
  eventType: string;
  lastMessageId: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

/**
 * Every drop row, newest activity first.
 *
 * No limit and no pagination: the unique constraint bounds this table to a
 * handful of rows by construction, so "recent" and "all" are the same list.
 */
export async function recentFeedbackDrops(): Promise<FeedbackDropRow[]> {
  try {
    const rows = await db
      .select({
        reason: feedbackDrops.reason,
        eventType: feedbackDrops.eventType,
        lastMessageId: feedbackDrops.lastMessageId,
        count: feedbackDrops.count,
        firstSeenAt: feedbackDrops.firstSeenAt,
        lastSeenAt: feedbackDrops.lastSeenAt,
      })
      .from(feedbackDrops)
      .orderBy(desc(feedbackDrops.lastSeenAt));
    return rows;
  } catch (err) {
    console.error("[feedback-log] could not read drops:", err);
    return [];
  }
}

/**
 * One line explaining what a reason means, for the admin console.
 *
 * Written for somebody deciding whether to act, not to define the term. The
 * two reasons need very different responses, and a console that showed only a
 * count would leave an operator unable to tell an expected background rate
 * from an outage.
 */
export function describeDropReason(reason: FeedbackDropReason): string {
  switch (reason) {
    case "no_message_id":
      return "SES sent feedback with no message id, so there was nothing to match on. Always unattributable; a rising count points at the notification configuration rather than at any workspace.";
    case "unmapped_message_id":
      return "The message id matched no campaign recipient. Expected at a low rate — transactional ticket mail shares the configuration set and has no recipient row — but a jump means campaign sends have stopped recording their provider ids, and no bounce is suppressing anybody.";
  }
}
