import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  tickets,
  contacts,
  contactNotes,
  ticketMessages,
  type TicketSource,
  type TicketStatus,
} from "@/db/schema";
import { TICKETS_PAGE_SIZE, getWorkspaceAgentId } from "@/lib/data";
import { labelsForTickets, type LabelChip } from "@/lib/labels";
import { previewText, relativeTime } from "@/lib/tickets";
import { extractSharedLinks, type SharedLink } from "@/lib/shared-links";
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
  | "labeled"
  | "sent"
  /**
   * Soft-deleted, kept for 30 days, then purged.
   *
   * The ONLY folder that shows deleted tickets — folderWhere() excludes them
   * everywhere else from one place, so a new folder inherits the exclusion
   * rather than having to remember it.
   */
  | "trash"
  /**
   * Off my inbox, but not resolved and not deleted.
   *
   * Deliberately NOT the same as `closed`. Closing is a claim about the
   * conversation (the customer got their answer); archiving is a claim about
   * the view (I am done looking at this). A ticket can be archived and open,
   * or closed and unarchived. See db/schema.ts.
   */
  | "archived"
  /**
   * Hidden until a time that has not arrived yet.
   *
   * Derived from `snoozed_until > now()`, so a ticket leaves this folder and
   * returns to the inbox on its own with nothing having run. There is no
   * un-snooze job; see db/schema.ts for why there should not be one.
   */
  | "snoozed";

export const MAIL_FOLDERS: MailFolder[] = [
  "all",
  "unread",
  "awaiting",
  "inbox",
  "closed",
  "starred",
  "labeled",
  "sent",
  "archived",
  "snoozed",
  "trash",
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
 * When we last WROTE to this customer — the Sent folder's clock, and its
 * membership test (NOT NULL means "we have sent something").
 *
 * `automated = false` is doing real work here, and it is the whole difference
 * between a Sent folder and a second copy of All mail. The auto-acknowledgement
 * fires once per ticket at creation (lib/auto-reply-send.ts), so counting it
 * would put practically every ticket in Sent while telling you nothing about
 * what anyone actually wrote. Sent means "a person here replied".
 *
 * Deliberately NOT tickets.updated_at: that moves for inbound mail, status
 * changes and labelling, so sorting Sent by it would reorder the folder around
 * events that are not sends. The customer writing back must not make our reply
 * look newer than it is.
 *
 * Served by ticket_messages_ticket_direction_idx — (ticket_id, direction,
 * sent_at) — so this is a max off the end of the index, not a scan. The
 * `automated` filter is not in that index and is applied after, which is fine:
 * one ticket's outbound messages are a handful of rows.
 */
const lastHumanOutboundAt = sql`(
  SELECT max(m.sent_at) FROM ticket_messages m
  WHERE m.ticket_id = ${outerTicketId}
    AND m.direction = 'outbound'
    AND m.automated = false
)`;

/** Somebody here has replied to this ticket at least once. */
const sentExpr = sql`${lastHumanOutboundAt} IS NOT NULL`;

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

/**
 * Live, i.e. not in the trash. Exported because every other read of `tickets`
 * outside this file needs the same predicate, and two spellings of it would
 * eventually disagree.
 */
export const notDeleted = sql`${tickets.deletedAt} IS NULL`;

/** In the trash: soft-deleted and not yet purged. */
const isDeleted = sql`${tickets.deletedAt} IS NOT NULL`;

const notArchived = sql`${tickets.archivedAt} IS NULL`;
const isArchived = sql`${tickets.archivedAt} IS NOT NULL`;

/*
 * Snoozed is a question about NOW, not a stored flag.
 *
 * `now()` is evaluated by Postgres per query, so a ticket whose time has
 * passed stops matching `isSnoozed` and starts matching `notSnoozed` at the
 * moment it should, with nothing having run. That is the whole reason there is
 * no un-snooze job.
 *
 * Note `snoozed_until IS NULL OR …` in notSnoozed rather than a bare
 * comparison: in SQL, NULL > now() is NULL, not false, so a never-snoozed
 * ticket would fail a naive `snoozed_until <= now()` and vanish from every
 * working folder. That is the entire inbox disappearing, from a three-valued
 * logic slip.
 */
const isSnoozed = sql`${tickets.snoozedUntil} IS NOT NULL AND ${tickets.snoozedUntil} > now()`;
const notSnoozed = sql`(${tickets.snoozedUntil} IS NULL OR ${tickets.snoozedUntil} <= now())`;

/**
 * The folders that answer "what needs attention now".
 *
 * Archived and still-snoozed tickets are hidden from these and ONLY these.
 * They stay visible in All, Starred, Labelled, Sent and Closed, because those
 * answer "where is that ticket?" — a folder that hides mail somebody is
 * actively looking for is worse than one that shows too much.
 */
const WORKING_FOLDERS: MailFolder[] = ["inbox", "unread", "awaiting"];

function folderWhere(
  workspaceId: number,
  agentId: number | null,
  folder: MailFolder,
  labelId?: number,
): SQL | undefined {
  // The tenant filter. Everything else is ANDed onto it, so it can never be
  // dropped by adding a folder.
  const mine = eq(tickets.workspaceId, workspaceId);

  /*
   * The trash filter, applied the same way and for the same reason.
   *
   * Structured as "trash is the exception" rather than "each folder adds
   * `notDeleted`": a folder added later inherits the exclusion by doing
   * nothing, whereas the other arrangement hides deleted tickets everywhere
   * until somebody forgets once, and then a deleted ticket reappears in one
   * folder and nobody can say when it started.
   */
  const bin = folder === "trash" ? isDeleted : notDeleted;

  const extra: SQL[] = [];

  if (folder === "closed") extra.push(eq(tickets.status, "closed"));
  else if (folder === "inbox") extra.push(notClosed);
  else if (folder === "unread") extra.push(notClosed, unreadExpr(agentId));
  else if (folder === "awaiting")
    extra.push(notClosed, sql`${lastDirection} = 'inbound'`);
  else if (folder === "starred") extra.push(starredExpr(agentId));
  else if (folder === "labeled") extra.push(labeledExpr(workspaceId));
  // No status filter, unlike inbox/unread/awaiting: closing a ticket does not
  // unsend the reply we wrote on it.
  else if (folder === "sent") extra.push(sentExpr);
  else if (folder === "archived") extra.push(isArchived);
  else if (folder === "snoozed") extra.push(isSnoozed);

  /*
   * Applied AFTER the per-folder predicate and independently of it, so the two
   * cannot be confused for each other. A ticket that is both archived and
   * snoozed is hidden from the working folders once, and appears in both the
   * Archived and Snoozed lists — which is true of it.
   */
  if (WORKING_FOLDERS.includes(folder)) extra.push(notArchived, notSnoozed);

  if (labelId !== undefined) extra.push(hasLabelExpr(workspaceId, labelId));

  return and(mine, bin, ...extra);
}

export type MailCounts = {
  all: number;
  unread: number;
  awaiting: number;
  inbox: number;
  closed: number;
  starred: number;
  labeled: number;
  sent: number;
  /** Off the inbox, but neither resolved nor deleted. */
  archived: number;
  /** Hidden until a time that has not arrived yet. */
  snoozed: number;
  /** Soft-deleted and not yet purged. */
  trash: number;
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
      /*
       * This query does NOT go through folderWhere — it computes every folder
       * in one pass — so the trash predicate has to be spelled out here. Every
       * count except `trash` carries `notDeleted`, because a folder badge that
       * counts deleted tickets sends somebody looking for mail that is not
       * there, and a nav that says "Inbox 8" over a list of 7 is the kind of
       * small wrongness that makes people stop trusting the numbers.
       */
      .select({
        all: sql<number>`(count(*) FILTER (WHERE ${notDeleted}))::int`,
        inbox: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${notClosed} AND ${notArchived} AND ${notSnoozed}))::int`,
        closed: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${tickets.status} = 'closed'))::int`,
        awaiting: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${notClosed} AND ${notArchived} AND ${notSnoozed} AND ${lastDirection} = 'inbound'))::int`,
        unread: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${notClosed} AND ${notArchived} AND ${notSnoozed} AND ${unreadExpr(agentId)}))::int`,
        starred: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${starredExpr(agentId)}))::int`,
        labeled: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${labeledExpr(workspaceId)}))::int`,
        sent: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${sentExpr}))::int`,
        archived: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${isArchived}))::int`,
        snoozed: sql<number>`(count(*) FILTER (WHERE ${notDeleted} AND ${isSnoozed}))::int`,
        trash: sql<number>`(count(*) FILTER (WHERE ${isDeleted}))::int`,
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
      sent: row?.sent ?? 0,
      archived: row?.archived ?? 0,
      snoozed: row?.snoozed ?? 0,
      trash: row?.trash ?? 0,
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
  /**
   * When a person here last replied, and what they wrote. Null / null when
   * nobody has (auto-acknowledgements do not count — see lastHumanOutboundAt).
   * The Sent folder shows these instead of updatedAt and the newest body: in
   * Sent, "3d" has to mean "we wrote 3 days ago", not "something happened".
   *
   * Typed loosely because this is a raw SQL timestamp rather than a mapped
   * Drizzle column; relativeTime() takes Date | string either way.
   */
  lastSentAt: Date | string | null;
  lastSentBody: string | null;
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
        lastSentAt: sql<Date | string | null>`${lastHumanOutboundAt}`,
        lastSentBody: sql<string | null>`(
          SELECT m.body FROM ticket_messages m
          WHERE m.ticket_id = ${outerTicketId}
            AND m.direction = 'outbound'
            AND m.automated = false
          ORDER BY m.sent_at DESC, m.id DESC
          LIMIT 1
        )`,
        starred: sql<boolean>`${starredExpr(agentId)}`,
        unread: sql<boolean>`${unreadExpr(agentId)}`,
      })
      .from(tickets)
      .where(folderWhere(workspaceId, agentId, folder, labelId))
      // Sent is ordered by when WE last wrote; every other folder by the
      // ticket's own activity. Same reasoning as lastHumanOutboundAt: sorting
      // Sent by updated_at would let an inbound reply or a label change
      // reshuffle a list of our own sends. NULLS LAST is belt-and-braces —
      // folderWhere already excludes never-replied tickets from this folder.
      .orderBy(
        folder === "sent"
          ? sql`${lastHumanOutboundAt} DESC NULLS LAST`
          : desc(tickets.updatedAt),
      )
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
    sentTime: t.lastSentAt ? relativeTime(t.lastSentAt, now) : null,
    sentPreview: t.lastSentBody ? previewText(t.lastSentBody, 90) : "",
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

export type ContactNoteDTO = {
  id: number;
  body: string;
  authorLabel: string;
  createdAtIso: string;
};

/**
 * Internal notes about a contact, newest first.
 *
 * Keyed by email, not contact id: a ticket can exist with no `contacts` row at
 * all, and those are the oldest customers — the ones there is most to say
 * about. See the note on the table in db/schema.ts.
 *
 * The workspace is a parameter and the caller must resolve it from the
 * session. This file is not a "use server" module, so this is not reachable as
 * a POST endpoint; it is imported by Server Components only.
 */
export async function listContactNotes(
  workspaceId: number,
  email: string,
): Promise<ContactNoteDTO[]> {
  const address = email.trim().toLowerCase();
  const rows = await db
    .select({
      id: contactNotes.id,
      body: contactNotes.body,
      authorLabel: contactNotes.authorLabel,
      createdAt: contactNotes.createdAt,
    })
    .from(contactNotes)
    .where(
      and(
        eq(contactNotes.workspaceId, workspaceId),
        eq(contactNotes.contactEmail, address),
      ),
    )
    .orderBy(desc(contactNotes.createdAt))
    // A contact with two hundred notes is a different feature (paging), and
    // this rail is 290px wide. Cap it rather than render a wall.
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorLabel: r.authorLabel,
    createdAtIso: new Date(r.createdAt).toISOString(),
  }));
}

/**
 * Links this contact has exchanged with us, newest first.
 *
 * Derived from message bodies at read time — see lib/shared-links.ts. There is
 * no links table and nothing to backfill.
 *
 * Bounded twice on purpose: only this contact's tickets, and only the most
 * recent messages across them. A contact with a thousand messages is a paging
 * problem, not a reason for the rail to read a thousand rows.
 */
export async function listSharedLinks(
  workspaceId: number,
  email: string,
): Promise<SharedLink[]> {
  const address = email.trim().toLowerCase();

  const rows = await db
    .select({
      ticketId: ticketMessages.ticketId,
      body: ticketMessages.body,
      direction: ticketMessages.direction,
      sentAt: ticketMessages.sentAt,
    })
    .from(ticketMessages)
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    // Tenancy on the JOINED table: ticket_messages has no workspace_id of its
    // own, so the constraint has to come from the ticket it belongs to.
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        sql`lower(${tickets.customerEmail}) = ${address}`,
      ),
    )
    .orderBy(desc(ticketMessages.sentAt))
    .limit(200);

  return extractSharedLinks(
    rows.map((r) => ({
      ticketId: r.ticketId,
      body: r.body,
      direction: r.direction,
      createdAtIso: new Date(r.sentAt).toISOString(),
    })),
  );
}
