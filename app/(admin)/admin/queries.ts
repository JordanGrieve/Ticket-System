import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { periodKey } from "@/lib/usage";
import {
  PROVIDER_DAILY_CAP,
  PROVIDER_MONTHLY_CAP,
  PROVIDER_PLAN_NAME,
  quotaState,
  type QuotaState,
} from "@/lib/email-quota";
import { transactionalSentToday } from "@/lib/email-quota-store";
import {
  agents,
  campaignRecipients,
  campaigns,
  ticketMessages,
  usageCounters,
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

/**
 * Team size for EVERY workspace, in one statement.
 *
 * ── WHY BULK ──
 * The accounts table became interactive on 14 Sep 2026: selecting a client no
 * longer navigates, so the drawer's data has to be on the page before anybody
 * clicks. Done per-row that would be a query per workspace on every render of
 * the console — the N+1 that only shows up once there are enough clients to
 * matter, by which time it is the slowest page in the product.
 *
 * The predicate is a copy of the one in `listAgentEmails`, and has to stay one:
 * placeholder rows are invited-but-never-signed-in, and counting them would
 * tell an operator a client has three people when it has one. Kept honest by
 * tests/admin-agent-count-predicate.test.ts rather than by hoping.
 */
export async function agentCountsByWorkspace(): Promise<Map<number, number>> {
  const rows = await db
    .select({
      workspaceId: agents.workspaceId,
      n: sql<number>`count(distinct lower(${agents.email}))::int`,
    })
    .from(agents)
    .where(
      sql`${agents.clerkUserId} NOT LIKE 'INVITE\_%' AND ${agents.clerkUserId} NOT LIKE 'SEED\_%'`,
    )
    .groupBy(agents.workspaceId);

  return new Map(rows.map((r) => [r.workspaceId, Number(r.n)]));
}

/**
 * How much of the shared mail allowance has gone this month.
 *
 * ── WHY usage_counters AND NOT rate_limits ──
 * The daily counter (lib/email-quota-store.ts) lives in `rate_limits`, one row
 * per UTC day, and the daily health sweep PRUNES anything over 24 hours old. So
 * yesterday's row is already gone and a month cannot be summed from it. That is
 * correct for what it does — enforcing today's ceiling — and useless for this.
 *
 * `usage_counters` is per workspace per calendar month and is written by the
 * same send paths (`recordUsage(workspaceId, "emails_sent", n)`). Summing it
 * across workspaces is the platform's month.
 *
 * ── WHAT IT UNDERCOUNTS, AND BY HOW MUCH ──
 * Mail with no workspace behind it: operator invites sent from this console.
 * lib/email.ts takes `workspaceId` as optional precisely so that case can be
 * expressed, and it is the only caller that omits it. A handful a month against
 * an allowance in the thousands — so the number is honest enough to steer by
 * and wrong enough that it must not be the thing that decides whether a send is
 * refused. Nothing refuses a send on it; see lib/email-quota.ts.
 */
export async function platformEmailsThisMonth(
  now = new Date(),
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${usageCounters.count}), 0)::int` })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.metric, "emails_sent"),
        eq(usageCounters.period, periodKey(now)),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/**
 * How close OUR mail provider account is to its plan.
 *
 * Not a tenant's allowance — the shared Resend account every workspace's mail
 * leaves through. An operator needs this before a plan is exhausted rather than
 * after, because the failure it prevents is invisible from the client side: a
 * refused send is a console.error and an acknowledgement that never arrives.
 *
 * Both numbers cover ticket mail AND newsletters, because both go out through
 * the same `/emails` API on the same allowance (lib/deliver-resend.ts).
 *
 * `todayKnown` is a third state and is deliberately not folded into a zero. The
 * daily counter can be unreadable — it lives in `rate_limits` and the read can
 * fail — and "we do not know" has to be distinguishable on screen from "a quiet
 * morning", which is the same argument lib/email-quota-store.ts makes for
 * throwing rather than returning 0.
 */
export type ProviderAllowance = {
  planName: string;
  today: QuotaState;
  todayKnown: boolean;
  month: QuotaState;
};

export async function providerAllowance(
  now = new Date(),
): Promise<ProviderAllowance> {
  const [today, month] = await Promise.all([
    transactionalSentToday(now).then(
      (q) => ({ q, known: true }),
      () => ({ q: quotaState(0, PROVIDER_DAILY_CAP), known: false }),
    ),
    platformEmailsThisMonth(now),
  ]);

  return {
    planName: PROVIDER_PLAN_NAME,
    today: today.q,
    todayKnown: today.known,
    month: quotaState(month, PROVIDER_MONTHLY_CAP),
  };
}
