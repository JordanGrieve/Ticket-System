import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  lists,
  listSubscribers,
  subscribers,
  suppressions,
  type ConsentMethod,
  type SubscriberStatus,
  type SuppressionReason,
} from "@/db/schema";

/**
 * Reads behind /subscribers. Kept beside the route rather than in lib/data.ts
 * for the same reason app/(dashboard)/newsletters/queries.ts is: lib/data.ts is
 * the support-desk's data module (tickets, messages, contacts) and knows
 * nothing about the mailer tables. Nothing outside this route needs these.
 *
 * ── TENANCY ──
 * `workspaceId` is a required first argument on every function here, and every
 * caller takes it from resolveViewer(), never from the URL. `subscribers`,
 * `lists` and `suppressions` all carry workspace_id directly, so the filter is
 * a column comparison rather than a join.
 *
 * The detail read is the one that matters: it filters by id AND workspace_id in
 * the SAME where clause, so a subscriber belonging to another tenant is not
 * "fetched then rejected" — it is never returned by the database at all. There
 * is no code path here that loads a row by id alone.
 *
 * ── UNBOUNDED SELECTS ──
 * `subscribers` is the table that grows fastest in this product; a list page
 * that selected all of it would be a full scan per render. Everything here is
 * either capped by LIMIT/OFFSET, aggregated in the database, or keyed to a
 * single subscriber.
 */

/** One page of the subscriber list. 50 fits the reading column comfortably. */
export const SUBSCRIBERS_PAGE_SIZE = 50;

/** Membership chips on the detail page are capped too — a subscriber on a
 *  hundred lists is a data problem, not a layout the page should try to render. */
const MEMBERSHIP_CAP = 24;

export const SUBSCRIBER_STATUSES: SubscriberStatus[] = [
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
];

/** `?status=` → a real status, or null for "all". Never trusts the raw value. */
export function parseStatus(raw: string | undefined): SubscriberStatus | null {
  return SUBSCRIBER_STATUSES.includes(raw as SubscriberStatus)
    ? (raw as SubscriberStatus)
    : null;
}

export type SubscriberRow = {
  id: number;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  source: string | null;
  subscribedAt: Date;
  consentMethod: ConsentMethod | null;
  consentAt: Date | null;
};

/**
 * One page of subscribers, newest first.
 *
 * Returns `hasMore` rather than a second COUNT: the page's totals already come
 * from statusCounts() below, and asking twice for the same number invites the
 * two answers to disagree across a concurrent signup.
 */
export async function listSubscriberPage(
  workspaceId: number,
  status: SubscriberStatus | null,
  page: number,
): Promise<{ rows: SubscriberRow[]; hasMore: boolean }> {
  const offset = (page - 1) * SUBSCRIBERS_PAGE_SIZE;

  const found = await db
    .select({
      id: subscribers.id,
      email: subscribers.email,
      name: subscribers.name,
      status: subscribers.status,
      source: subscribers.source,
      subscribedAt: subscribers.subscribedAt,
      consentMethod: subscribers.consentMethod,
      consentAt: subscribers.consentAt,
    })
    .from(subscribers)
    .where(
      status === null
        ? eq(subscribers.workspaceId, workspaceId)
        : and(
            eq(subscribers.workspaceId, workspaceId),
            eq(subscribers.status, status),
          ),
    )
    // id as a tiebreaker: subscribed_at defaults to now() and a bulk import can
    // hand a whole batch the same timestamp, which would otherwise let a row
    // appear on two pages (or on neither) as the paginator walks past it.
    .orderBy(desc(subscribers.subscribedAt), desc(subscribers.id))
    // One extra row is the cheapest possible "is there a next page".
    .limit(SUBSCRIBERS_PAGE_SIZE + 1)
    .offset(offset);

  return {
    rows: found.slice(0, SUBSCRIBERS_PAGE_SIZE),
    hasMore: found.length > SUBSCRIBERS_PAGE_SIZE,
  };
}

export type StatusCounts = Record<SubscriberStatus, number> & { all: number };

/**
 * How many subscribers sit in each status. One grouped COUNT, served by
 * subscribers_workspace_status_idx, feeding every filter pill at once.
 */
export async function statusCounts(workspaceId: number): Promise<StatusCounts> {
  const rows = await db
    .select({
      status: subscribers.status,
      count: sql<number>`count(*)::int`,
    })
    .from(subscribers)
    .where(eq(subscribers.workspaceId, workspaceId))
    .groupBy(subscribers.status);

  const counts: StatusCounts = {
    all: 0,
    subscribed: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
  };
  for (const r of rows) {
    // A status that predates a widening of the union would otherwise write a
    // stray key onto the object and be invisible in the pills.
    if (r.status in counts) counts[r.status] = r.count;
    counts.all += r.count;
  }
  return counts;
}

export type SubscriberDetail = {
  subscriber: typeof subscribers.$inferSelect;
  lists: { id: number; name: string }[];
  /** Workspace-wide block on this address, if one exists. */
  suppression: {
    reason: SuppressionReason;
    note: string | null;
    createdAt: Date;
  } | null;
};

/**
 * One subscriber, with the two facts the consent screen has to show beside the
 * evidence: which audiences they are on, and whether the address is suppressed.
 *
 * Returns null both for "no such subscriber" and for "belongs to someone else".
 * The caller cannot tell those apart, which is the intent — a 404 that only
 * fires for genuinely absent ids is an existence oracle across tenants.
 */
export async function getSubscriberDetail(
  workspaceId: number,
  subscriberId: number,
): Promise<SubscriberDetail | null> {
  const [row] = await db
    .select()
    .from(subscribers)
    // Both predicates, one clause. Never "fetch by id, compare afterwards".
    .where(
      and(
        eq(subscribers.id, subscriberId),
        eq(subscribers.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const [memberships, blocks] = await Promise.all([
    db
      .select({ id: lists.id, name: lists.name })
      .from(listSubscribers)
      .innerJoin(lists, eq(lists.id, listSubscribers.listId))
      // list_subscribers has no workspaceId of its own (see the schema header);
      // it inherits tenancy through `lists`, so the filter goes on the parent.
      .where(
        and(
          eq(listSubscribers.subscriberId, row.id),
          eq(lists.workspaceId, workspaceId),
        ),
      )
      .orderBy(lists.name)
      .limit(MEMBERSHIP_CAP),
    db
      .select({
        reason: suppressions.reason,
        note: suppressions.note,
        createdAt: suppressions.createdAt,
      })
      .from(suppressions)
      // Suppressions are keyed by address, not by subscriber id — that is the
      // whole point of the table, so this is a (workspace, email) lookup.
      .where(
        and(
          eq(suppressions.workspaceId, workspaceId),
          eq(suppressions.email, row.email),
        ),
      )
      .limit(1),
  ]);

  return {
    subscriber: row,
    lists: memberships,
    suppression: blocks[0] ?? null,
  };
}
