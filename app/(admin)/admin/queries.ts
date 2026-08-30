import "server-only";
import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaignRecipients,
  campaigns,
  ticketMessages,
  workspaces,
  type CampaignStatus,
  type DeliveryStatus,
  type RecipientStatus,
} from "@/db/schema";

/**
 * The reads that exist only for the operator console.
 *
 * ── WHY THESE ARE NOT IN lib/data.ts ──
 * Everything here is deliberately PLATFORM-WIDE. lib/data.ts is shared with
 * tenant-facing pages, where a query that spans every workspace is a leak; a
 * function that is correct here and catastrophic there should not sit in the
 * same file as the ones a dashboard page imports. Keeping them under
 * app/(admin) means the blast radius of "somebody imported the wrong helper"
 * is a file only the admin console can reach.
 *
 * ── WHAT MAKES THE CROSS-TENANT READS SAFE ──
 * Every one of them returns COUNTS GROUPED BY A STATUS COLUMN. No address, no
 * subject, no message body and no per-recipient row ever leaves these
 * functions, so there is nothing here that could show one client another
 * client's mail even if the console were reached by the wrong person. The
 * per-workspace usage read below is the exception in shape but not in kind: it
 * is scoped by workspace_id inside the statement and returns two integers.
 *
 * They are written with the Drizzle query builder rather than raw SQL on
 * purpose. tests/tenancy-invariants.test.ts polices raw statements against
 * tenant tables, and an unscoped raw statement here would have to be argued
 * into its exemption list; a grouped count through the builder cannot select a
 * column it was not asked for, which is the property that actually matters.
 */

/* ────────────────────────────────────────────────────────────────────────
   BILLING USAGE
   ──────────────────────────────────────────────────────────────────────── */

export type WorkspaceUsage = {
  /** Confirmed subscribers held right now. Unconfirmed ones are not stored. */
  subscribers: number;
  /**
   * Tickets opened since the trial clock started.
   *
   * The same window lib/billing-query.ts counts, so the console and the
   * product agree about whether a trial has hit its cap. Counted for every
   * workspace and not only trials — on a paid plan it is simply "tickets since
   * they signed up", which is the number an operator asks for when a client
   * says the product is quiet.
   */
  ticketsSinceTrialStart: number;
};

/**
 * Usage per workspace, in one round trip.
 *
 * Correlated subqueries rather than two grouped scans and a merge: over
 * neon-http each statement is its own HTTP request, and this feeds a table
 * that already has the workspace rows in hand.
 */
export async function listWorkspaceUsage(): Promise<Map<number, WorkspaceUsage>> {
  const rows = await db
    .select({
      id: workspaces.id,
      subscribers: sql<number>`(
        SELECT count(*)::int FROM subscribers s
        WHERE s.workspace_id = ${workspaces.id}
          AND s.status = 'subscribed'
      )`,
      tickets: sql<number>`(
        SELECT count(*)::int FROM tickets t
        WHERE t.workspace_id = ${workspaces.id}
          AND t.created_at >= ${workspaces.trialStartedAt}
      )`,
    })
    .from(workspaces);

  return new Map(
    rows.map((r) => [
      r.id,
      {
        subscribers: r.subscribers ?? 0,
        ticketsSinceTrialStart: r.tickets ?? 0,
      },
    ]),
  );
}

/* ────────────────────────────────────────────────────────────────────────
   DELIVERY
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Outbound ticket mail by delivery status — replies and auto-acknowledgements.
 *
 * `null` is a real bucket and is counted as such: the column is only written
 * by the send path (lib/auto-reply-send.ts and the reply route), so a null on
 * an outbound row means the message predates that being recorded. Folding it
 * into "sent" would quietly claim we know something about mail we do not.
 */
export type TransactionalTotals = {
  byStatus: Record<DeliveryStatus, number>;
  /** Outbound rows with no status at all. */
  unrecorded: number;
  /** Every outbound row, including the unrecorded ones. */
  total: number;
};

export async function transactionalDeliveryTotals(): Promise<TransactionalTotals> {
  const rows = await db
    .select({
      status: ticketMessages.deliveryStatus,
      n: count(),
    })
    .from(ticketMessages)
    .where(eq(ticketMessages.direction, "outbound"))
    .groupBy(ticketMessages.deliveryStatus);

  const byStatus: Record<DeliveryStatus, number> = {
    queued: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    bounced: 0,
  };
  let unrecorded = 0;
  let total = 0;
  for (const row of rows) {
    total += row.n;
    if (row.status === null) unrecorded += row.n;
    else byStatus[row.status] += row.n;
  }
  return { byStatus, unrecorded, total };
}

/**
 * Newsletter sends by recipient status, and campaigns by campaign status.
 *
 * Both, because they answer different questions and the difference is the one
 * that matters here: a campaign marked "sent" whose recipients are all still
 * "queued" is a stalled send, and a campaign marked "sent" in log-only mode is
 * a send that reached nobody. Neither is visible from one number alone.
 */
export type CampaignTotals = {
  recipients: Record<RecipientStatus, number>;
  campaigns: Record<CampaignStatus, number>;
};

export async function campaignDeliveryTotals(): Promise<CampaignTotals> {
  const [recipientRows, campaignRows] = await Promise.all([
    db
      .select({ status: campaignRecipients.status, n: count() })
      .from(campaignRecipients)
      .groupBy(campaignRecipients.status),
    db
      .select({ status: campaigns.status, n: count() })
      .from(campaigns)
      .groupBy(campaigns.status),
  ]);

  const recipients: Record<RecipientStatus, number> = {
    queued: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
  };
  for (const row of recipientRows) recipients[row.status] += row.n;

  const campaignCounts: Record<CampaignStatus, number> = {
    draft: 0,
    scheduled: 0,
    sending: 0,
    sent: 0,
    failed: 0,
  };
  for (const row of campaignRows) campaignCounts[row.status] += row.n;

  return { recipients, campaigns: campaignCounts };
}
