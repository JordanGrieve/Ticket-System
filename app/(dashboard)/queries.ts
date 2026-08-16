import "server-only";
import { cache } from "react";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  tickets,
  contacts,
  type TicketSource,
  type TicketStatus,
} from "@/db/schema";
import { TICKETS_PAGE_SIZE } from "@/lib/data";
import { previewText, relativeTime } from "@/lib/tickets";
import type { MailRow } from "@/components/mail/types";

/**
 * Reads the rebuilt mail client needs that lib/data.ts does not expose yet.
 *
 * These live here rather than in lib/ because lib/ and db/ are being changed
 * concurrently by another agent; nothing in this file adds a column or a table,
 * it only reads what the current schema already stores. Every query is scoped
 * by workspaceId — ticket_messages has no workspace column of its own, so it is
 * always reached through its ticket, which is the tenant filter.
 */

/**
 * Folders the list pane understands.
 *
 * "awaiting" is the closest honest thing we have to the design's "Unread":
 * there is no read/unread state in the schema, but "the last message on this
 * ticket came from the customer" is real, and it is what an agent actually
 * wants that column for. It is labelled "Awaiting reply" in the UI, never
 * "Unread".
 */
export type MailFolder = "all" | "awaiting" | "inbox" | "closed";

export const MAIL_FOLDERS: MailFolder[] = [
  "all",
  "awaiting",
  "inbox",
  "closed",
];

export function parseFolder(value: string | undefined): MailFolder {
  return (MAIL_FOLDERS as string[]).includes(value ?? "")
    ? (value as MailFolder)
    : "inbox";
}

/** SQL for "the direction of this ticket's most recent message". */
const lastDirection = sql<string | null>`(
  SELECT m.direction FROM ticket_messages m
  WHERE m.ticket_id = ${tickets.id}
  ORDER BY m.sent_at DESC, m.id DESC
  LIMIT 1
)`;

function folderWhere(workspaceId: number, folder: MailFolder) {
  const mine = eq(tickets.workspaceId, workspaceId);
  if (folder === "all") return mine;
  if (folder === "closed") return and(mine, eq(tickets.status, "closed"));
  if (folder === "inbox") return and(mine, sql`${tickets.status} != 'closed'`);
  return and(mine, sql`${tickets.status} != 'closed'`, sql`${lastDirection} = 'inbound'`);
}

export type MailCounts = {
  all: number;
  awaiting: number;
  inbox: number;
  closed: number;
};

/**
 * All four folder counts in one round trip. Cached per request so the layout
 * (sidebar) and the page (pagination) share it.
 */
export const mailCounts = cache(
  async (workspaceId: number): Promise<MailCounts> => {
    const [row] = await db
      .select({
        all: sql<number>`count(*)::int`,
        inbox: sql<number>`(count(*) FILTER (WHERE ${tickets.status} != 'closed'))::int`,
        closed: sql<number>`(count(*) FILTER (WHERE ${tickets.status} = 'closed'))::int`,
        awaiting: sql<number>`(count(*) FILTER (WHERE ${tickets.status} != 'closed' AND ${lastDirection} = 'inbound'))::int`,
      })
      .from(tickets)
      .where(eq(tickets.workspaceId, workspaceId));

    return {
      all: row?.all ?? 0,
      inbox: row?.inbox ?? 0,
      closed: row?.closed ?? 0,
      awaiting: row?.awaiting ?? 0,
    };
  },
);

/**
 * Only the columns the list pane draws. Deliberately NOT `typeof
 * tickets.$inferSelect` — the schema is being edited concurrently, and a
 * column added there should not silently become part of this shape.
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
  /** Direction of the newest message; drives the "awaiting reply" dot. */
  lastDirection: string | null;
  messageCount: number;
};

/**
 * One page of a folder with the extra per-ticket facts the mail card shows.
 * Cached per request because /tickets/[id] renders the list pane too, and the
 * layout may ask for the same page.
 */
export const listMailPage = cache(
  async (
    workspaceId: number,
    folder: MailFolder,
    page: number,
  ): Promise<TicketListRow[]> => {
    return db
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
          WHERE m.ticket_id = ${tickets.id}
          ORDER BY m.sent_at DESC, m.id DESC
          LIMIT 1
        )`,
        lastDirection,
        messageCount: sql<number>`(
          SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = ${tickets.id}
        )`,
      })
      .from(tickets)
      .where(folderWhere(workspaceId, folder))
      .orderBy(desc(tickets.updatedAt))
      .limit(TICKETS_PAGE_SIZE)
      .offset((Math.max(1, page) - 1) * TICKETS_PAGE_SIZE);
  },
);

/**
 * Database row → list card. The only derived value is `awaitingReply`, which is
 * "the newest message came from the customer" — see MailFolder above for why
 * that stands in for the design's unread dot.
 */
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
