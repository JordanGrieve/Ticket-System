import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  tickets,
  contacts,
  type TicketSource,
  type TicketStatus,
} from "@/db/schema";
import { TICKETS_PAGE_SIZE, getWorkspaceAgentId } from "@/lib/data";
import { labelsForTickets, type LabelChip } from "@/lib/labels";
import { previewText, relativeTime } from "@/lib/tickets";
import type { MailRow } from "@/components/mail/types";

/**
 * Reads the mail client needs that lib/data.ts does not expose.
 *
 * TENANCY. Every query below starts from `tickets` and filters
 * `tickets.workspace_id`. ticket_messages, ticket_labels, ticket_stars and
 * ticket_reads have no workspace column of their own, so they are only ever
 * reached as correlated subqueries hanging off `tickets.id` inside a statement
 * whose outer WHERE already pins the workspace — that outer predicate is what
 * makes them safe. None of them is ever queried standalone here.
 */

/**
 * Who is looking, inside this workspace.
 *
 * Stars and read receipts are per agent, so they need an agent id — and a
 * super-admin viewing a client has none (see getWorkspaceAgentId). Rather than
 * fake one, `null` here means "this viewer has no personal state", and the UI
 * hides the personal folders instead of showing them all reading zero.
 *
 * Cached per request: the layout, the list page and the thread page all ask.
 */
export const viewerAgentId = cache(
  async (workspaceId: number): Promise<number | null> => {
    const { userId } = await auth();
    if (!userId) return null;
    return getWorkspaceAgentId(workspaceId, userId);
  },
);

/**
 * Folders the list pane understands.
 *
 * "unread" and "awaiting" are BOTH here on purpose, and they are not two names
 * for one thing:
 *
 *   awaiting — the newest message on the ticket came from the customer. A
 *     property of the ticket, shared by the whole team: nobody has answered
 *     this person yet. It survives you reading the thread.
 *   unread   — *you* have not looked at the newest inbound message. A property
 *     of you: a colleague reading it does not clear yours, and replying does
 *     not make it come back.
 *
 * A ticket can sit in either without the other — read but unanswered (you
 * looked, you haven't replied), or answered but unread (a colleague handled it
 * and you never opened it). Collapsing them would lose a real distinction, so
 * the nav carries both.
 */
export type MailFolder =
  | "all"
  | "unread"
  | "awaiting"
  | "inbox"
  | "closed"
  | "starred"
  | "labeled";

export const MAIL_FOLDERS: MailFolder[] = [
  "all",
  "unread",
  "awaiting",
  "inbox",
  "closed",
  "starred",
  "labeled",
];

export function parseFolder(value: string | undefined): MailFolder {
  return (MAIL_FOLDERS as string[]).includes(value ?? "")
    ? (value as MailFolder)
    : "inbox";
}

/**
 * A literal reference to the outer ticket's id, for use inside the correlated
 * subqueries below.
 *
 * NOT a Drizzle Column reference. Drizzle renders one unqualified — plain
 * `"id"` —
 * when it is a top-level field of a single-table select, and every one of
 * these subqueries selects FROM a table that also has an `id`
 * (ticket_messages, labels). Postgres then binds the bare `"id"` to the INNER
 * table, so `m.ticket_id = "id"` quietly becomes `m.ticket_id = m.id` and the
 * row gets somebody else's message. The same fragment renders qualified when
 * it is nested one level deeper (inside a FILTER, say), so the bug appears in
 * some columns and not others — which is exactly how it survived. Spelling the
 * reference out removes the dependence on where the fragment happens to land.
 */
const outerTicketId = sql.raw(`"tickets"."id"`);

/** SQL for "the direction of this ticket's most recent message". */
const lastDirection = sql<string | null>`(
  SELECT m.direction FROM ticket_messages m
  WHERE m.ticket_id = ${outerTicketId}
  ORDER BY m.sent_at DESC, m.id DESC
  LIMIT 1
)`;

/**
 * When the customer last wrote. The anchor for unread — deliberately NOT
 * tickets.updated_at.
 *
 * updated_at is bumped by addMessage on EVERY message, including the agent's
 * own outbound reply, and by any status change. Comparing that to last_read_at
 * means answering a ticket instantly marks it unread again for you, and worse,
 * marks it unread for every teammate who had already read it — a colleague's
 * reply is not new mail. Anchoring on the newest inbound message is immune to
 * all of that, and it stays correct for any future write that touches
 * updated_at (closing, labelling, merging).
 */
const lastInboundAt = sql`(
  SELECT max(m.sent_at) FROM ticket_messages m
  WHERE m.ticket_id = ${outerTicketId} AND m.direction = 'inbound'
)`;

/**
 * Unread for this agent: the customer has written something newer than this
 * agent's read receipt. No receipt row is treated as "read nothing" via the
 * epoch fallback, so an untouched ticket with inbound mail is unread.
 */
function unreadExpr(agentId: number | null): SQL {
  if (agentId === null) return sql`false`;
  return sql`(
    ${lastInboundAt} IS NOT NULL
    AND ${lastInboundAt} > COALESCE((
      SELECT r.last_read_at FROM ticket_reads r
      WHERE r.ticket_id = ${outerTicketId} AND r.agent_id = ${agentId}
    ), 'epoch'::timestamptz)
  )`;
}

function starredExpr(agentId: number | null): SQL {
  if (agentId === null) return sql`false`;
  return sql`EXISTS (
    SELECT 1 FROM ticket_stars s
    WHERE s.ticket_id = ${outerTicketId} AND s.agent_id = ${agentId}
  )`;
}

/**
 * Has at least one label. The join up to `labels` and its workspace filter is
 * belt-and-braces — the outer query already restricts `tickets` to this
 * workspace, and a ticket can only be labelled by its own workspace's labels.
 */
function labeledExpr(workspaceId: number): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ticket_labels tl
    JOIN labels l ON l.id = tl.label_id
    WHERE tl.ticket_id = ${outerTicketId} AND l.workspace_id = ${workspaceId}
  )`;
}

/** Carries exactly one label. Used by the per-label sidebar entries. */
function hasLabelExpr(workspaceId: number, labelId: number): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ticket_labels tl
    JOIN labels l ON l.id = tl.label_id
    WHERE tl.ticket_id = ${outerTicketId}
      AND tl.label_id = ${labelId}
      AND l.workspace_id = ${workspaceId}
  )`;
}

const notClosed = sql`${tickets.status} != 'closed'`;

function folderWhere(
  workspaceId: number,
  agentId: number | null,
  folder: MailFolder,
  labelId?: number,
): SQL | undefined {
  // The tenant filter. Everything else is ANDed onto it, so it can never be
  // dropped by adding a folder.
  const mine = eq(tickets.workspaceId, workspaceId);
  const extra: SQL[] = [];

  if (folder === "closed") extra.push(eq(tickets.status, "closed"));
  else if (folder === "inbox") extra.push(notClosed);
  else if (folder === "unread") extra.push(notClosed, unreadExpr(agentId));
  else if (folder === "awaiting")
    extra.push(notClosed, sql`${lastDirection} = 'inbound'`);
  else if (folder === "starred") extra.push(starredExpr(agentId));
  else if (folder === "labeled") extra.push(labeledExpr(workspaceId));

  if (labelId !== undefined) extra.push(hasLabelExpr(workspaceId, labelId));

  return and(mine, ...extra);
}

export type MailCounts = {
  all: number;
  unread: number;
  awaiting: number;
  inbox: number;
  closed: number;
  starred: number;
  labeled: number;
};

/**
 * All folder counts in one round trip.
 *
 * The agent id is resolved here rather than passed in, so every caller shares
 * one request-cached query — including the dashboard layout, which knows only
 * the workspace. Passing it would have given the layout and the page different
 * cache keys and run the count twice.
 */
export const mailCounts = cache(
  async (workspaceId: number): Promise<MailCounts> => {
    const agentId = await viewerAgentId(workspaceId);
    const [row] = await db
      .select({
        all: sql<number>`count(*)::int`,
        inbox: sql<number>`(count(*) FILTER (WHERE ${notClosed}))::int`,
        closed: sql<number>`(count(*) FILTER (WHERE ${tickets.status} = 'closed'))::int`,
        awaiting: sql<number>`(count(*) FILTER (WHERE ${notClosed} AND ${lastDirection} = 'inbound'))::int`,
        unread: sql<number>`(count(*) FILTER (WHERE ${notClosed} AND ${unreadExpr(agentId)}))::int`,
        starred: sql<number>`(count(*) FILTER (WHERE ${starredExpr(agentId)}))::int`,
        labeled: sql<number>`(count(*) FILTER (WHERE ${labeledExpr(workspaceId)}))::int`,
      })
      .from(tickets)
      .where(eq(tickets.workspaceId, workspaceId));

    return {
      all: row?.all ?? 0,
      inbox: row?.inbox ?? 0,
      closed: row?.closed ?? 0,
      awaiting: row?.awaiting ?? 0,
      unread: row?.unread ?? 0,
      starred: row?.starred ?? 0,
      labeled: row?.labeled ?? 0,
    };
  },
);

/** COUNT(*) for a view the folder counts don't cover (a single label). */
export const mailFolderTotal = cache(
  async (
    workspaceId: number,
    folder: MailFolder,
    labelId?: number,
  ): Promise<number> => {
    const agentId = await viewerAgentId(workspaceId);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(folderWhere(workspaceId, agentId, folder, labelId));
    return row?.n ?? 0;
  },
);

/**
 * Only the columns the list pane draws. Deliberately NOT `typeof
 * tickets.$inferSelect` — a column added to the schema should not silently
 * become part of this shape.
 */
export type TicketListRow = {
  id: number;
  source: TicketSource;
  orderId: string | null;
  customerName: string;
  customerEmail: string;
  subject: string;
  status: TicketStatus;
  updatedAt: Date;
  /** Body of the newest message — the preview line in the design. */
  lastBody: string | null;
  /** Direction of the newest message; drives the "awaiting reply" chip. */
  lastDirection: string | null;
  messageCount: number;
  /** Per-agent. Always false when the viewer has no agent row. */
  starred: boolean;
  unread: boolean;
  labels: LabelChip[];
};

/**
 * One page of a folder with the extra per-ticket facts the mail card shows.
 * Cached per request because /tickets/[id] renders the list pane too.
 */
export const listMailPage = cache(
  async (
    workspaceId: number,
    folder: MailFolder,
    page: number,
    labelId?: number,
  ): Promise<TicketListRow[]> => {
    const agentId = await viewerAgentId(workspaceId);
    const rows = await db
      .select({
        id: tickets.id,
        source: tickets.source,
        orderId: tickets.orderId,
        customerName: tickets.customerName,
        customerEmail: tickets.customerEmail,
        subject: tickets.subject,
        status: tickets.status,
        updatedAt: tickets.updatedAt,
        lastBody: sql<string | null>`(
          SELECT m.body FROM ticket_messages m
          WHERE m.ticket_id = ${outerTicketId}
          ORDER BY m.sent_at DESC, m.id DESC
          LIMIT 1
        )`,
        lastDirection,
        messageCount: sql<number>`(
          SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = ${outerTicketId}
        )`,
        starred: sql<boolean>`${starredExpr(agentId)}`,
        unread: sql<boolean>`${unreadExpr(agentId)}`,
      })
      .from(tickets)
      .where(folderWhere(workspaceId, agentId, folder, labelId))
      .orderBy(desc(tickets.updatedAt))
      .limit(TICKETS_PAGE_SIZE)
      .offset((Math.max(1, page) - 1) * TICKETS_PAGE_SIZE);

    // One extra round trip for the whole page rather than a subquery per row.
    // Workspace-filtered on both parents inside labelsForTickets.
    const byTicket = await labelsForTickets(
      workspaceId,
      rows.map((r) => r.id),
    );

    return rows.map((r) => ({
      ...r,
      starred: Boolean(r.starred),
      unread: Boolean(r.unread),
      labels: byTicket.get(r.id) ?? [],
    }));
  },
);

/** Database row → list card. */
export function toMailRow(t: TicketListRow, now: Date = new Date()): MailRow {
  return {
    id: t.id,
    name: t.customerName,
    email: t.customerEmail,
    subject: t.subject,
    preview: t.lastBody ? previewText(t.lastBody, 90) : "",
    time: relativeTime(t.updatedAt, now),
    source: t.source,
    status: t.status,
    orderId: t.orderId,
    awaitingReply: t.lastDirection === "inbound" && t.status !== "closed",
    starred: t.starred,
    unread: t.unread,
    labels: t.labels,
  };
}

/**
 * The thread header's own state: is this ticket starred by me, unread by me,
 * and what is on it. One query for the two per-agent booleans (both are
 * correlated subqueries on a row already pinned to the workspace), plus the
 * label read.
 */
export async function ticketPersonalState(
  workspaceId: number,
  ticketId: number,
): Promise<{ starred: boolean; unread: boolean; labels: LabelChip[] }> {
  const agentId = await viewerAgentId(workspaceId);
  const [flags, labels] = await Promise.all([
    db
      .select({
        starred: sql<boolean>`${starredExpr(agentId)}`,
        unread: sql<boolean>`${unreadExpr(agentId)}`,
      })
      .from(tickets)
      .where(
        and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)),
      )
      .limit(1),
    labelsForTickets(workspaceId, [ticketId]),
  ]);

  return {
    starred: Boolean(flags[0]?.starred),
    unread: Boolean(flags[0]?.unread),
    labels: labels.get(ticketId) ?? [],
  };
}

export type ContactFacts = {
  /** When this person first contacted the workspace. Null if never recorded. */
  firstSeenIso: string | null;
  /** How many tickets this email has opened in this workspace. */
  ticketCount: number;
};

/**
 * The two facts about a contact the rail can honestly show. Phone number,
 * lifecycle status and notes have no columns, so the rail says so instead of
 * inventing them.
 */
export async function getContactFacts(
  workspaceId: number,
  email: string,
): Promise<ContactFacts> {
  const address = email.trim().toLowerCase();
  const [row] = await db
    .select({
      firstSeen: contacts.firstSeen,
      ticketCount: sql<number>`(
        SELECT count(*)::int FROM tickets t
        WHERE t.workspace_id = ${workspaceId} AND t.customer_email = ${address}
      )`,
    })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, address)))
    .limit(1);

  if (row) {
    return {
      firstSeenIso: row.firstSeen ? new Date(row.firstSeen).toISOString() : null,
      ticketCount: row.ticketCount,
    };
  }

  // A ticket can exist without a contacts row (contacts were added later).
  const [fallback] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        eq(tickets.customerEmail, address),
      ),
    );
  return { firstSeenIso: null, ticketCount: fallback?.n ?? 0 };
}
