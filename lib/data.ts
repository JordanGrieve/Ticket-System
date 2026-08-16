import { and, asc, desc, eq, notLike, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  workspaces,
  tickets,
  ticketMessages,
  contacts,
  agents,
  type Workspace,
  type Ticket,
  type TicketMessage,
  type Agent,
  type TicketSource,
  type TicketStatus,
  type MessageDirection,
} from "@/db/schema";
import { generateReplyToken } from "./tokens";

// ── Workspace lookups ────────────────────────────────────────────

export async function getWorkspaceByApiKey(apiKey: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.apiKey, apiKey))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateWorkspace(
  workspaceId: number,
  patch: Partial<Pick<typeof workspaces.$inferInsert, "name" | "sendingEmail" | "accent">>,
) {
  const [updated] = await db
    .update(workspaces)
    .set(patch)
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return updated ?? null;
}

export async function getWorkspaceByInboundEmail(email: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.inboundEmail, email.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Mint a fresh API key for a workspace. The old key stops working
 * immediately — that's the point (rotation after a leak).
 */
export async function rotateWorkspaceApiKey(
  workspaceId: number,
  newKey: string,
): Promise<Workspace | null> {
  const [updated] = await db
    .update(workspaces)
    .set({ apiKey: newKey })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return updated ?? null;
}

export async function getWorkspaceById(id: number): Promise<Workspace | null> {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ── Agent lookups ────────────────────────────────────────────────

export async function getAgentByClerkId(
  clerkUserId: string,
): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0] ?? null;
}

/** A real (non-seed) agent for this email, if any — used to pre-link admins. */
export async function getRealAgentByEmail(email: string): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        sql`lower(${agents.email}) = ${email.trim().toLowerCase()}`,
        notLike(agents.clerkUserId, "SEED_%"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type WorkspaceSummary = Workspace & {
  openCount: number;
  totalCount: number;
  /** Email of the workspace's first agent (the owner / invited client). */
  ownerEmail: string | null;
  /** True while the owner hasn't signed in yet (SEED_/INVITE_ placeholder). */
  pending: boolean;
};

/**
 * Every workspace with its open/total ticket counts and owner/invite status —
 * the admin overview. "Open" means any status that isn't "closed".
 */
export async function listWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
  const [all, counts, allAgents] = await Promise.all([
    db.select().from(workspaces).orderBy(asc(workspaces.name)),
    db
      .select({
        workspaceId: tickets.workspaceId,
        status: tickets.status,
        count: sql<number>`count(*)::int`,
      })
      .from(tickets)
      .groupBy(tickets.workspaceId, tickets.status),
    db
      .select({
        workspaceId: agents.workspaceId,
        email: agents.email,
        clerkUserId: agents.clerkUserId,
      })
      .from(agents)
      .orderBy(asc(agents.id)),
  ]);

  const byWorkspace = new Map<number, { open: number; total: number }>();
  for (const row of counts) {
    const agg = byWorkspace.get(row.workspaceId) ?? { open: 0, total: 0 };
    agg.total += row.count;
    if (row.status !== "closed") agg.open += row.count;
    byWorkspace.set(row.workspaceId, agg);
  }

  // First agent per workspace = the owner (or the invited client).
  const ownerByWorkspace = new Map<number, { email: string; pending: boolean }>();
  for (const a of allAgents) {
    if (!ownerByWorkspace.has(a.workspaceId)) {
      ownerByWorkspace.set(a.workspaceId, {
        email: a.email,
        pending:
          a.clerkUserId.startsWith("SEED_") || a.clerkUserId.startsWith("INVITE_"),
      });
    }
  }

  return all.map((w) => ({
    ...w,
    openCount: byWorkspace.get(w.id)?.open ?? 0,
    totalCount: byWorkspace.get(w.id)?.total ?? 0,
    ownerEmail: ownerByWorkspace.get(w.id)?.email ?? null,
    pending: ownerByWorkspace.get(w.id)?.pending ?? false,
  }));
}

/**
 * Has this email already been ingested? Webhook deliveries are retried on
 * timeouts even after we processed them — matching on Message-ID makes
 * ingestion idempotent.
 */
export async function messageIdExists(messageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(eq(ticketMessages.messageId, messageId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Backfill the real Message-ID of our most recent outbound message that
 * doesn't have one yet. SES assigns Message-IDs we never see at send time —
 * but the customer's reply carries it in In-Reply-To, so we learn it here and
 * future replies can reference a complete chain.
 */
export async function backfillOutboundMessageId(
  ticketId: number,
  messageId: string,
): Promise<void> {
  const rows = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.ticketId, ticketId),
        eq(ticketMessages.direction, "outbound"),
        sql`${ticketMessages.messageId} IS NULL`,
      ),
    )
    .orderBy(desc(ticketMessages.sentAt))
    .limit(1);
  if (rows.length > 0) {
    await db
      .update(ticketMessages)
      .set({ messageId })
      .where(eq(ticketMessages.id, rows[0].id));
  }
}

/**
 * Permanently delete a workspace. Cascades wipe its tickets, messages,
 * contacts and agents (FKs are ON DELETE CASCADE). Admin-only callers must
 * double-confirm first. Returns the deleted row, or null if id didn't exist.
 */
export async function deleteWorkspace(id: number): Promise<Workspace | null> {
  const [deleted] = await db
    .delete(workspaces)
    .where(eq(workspaces.id, id))
    .returning();
  return deleted ?? null;
}

/** The workspace's pending (not-yet-signed-in) agent, if any. */
export async function getPendingAgent(workspaceId: number): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, workspaceId),
        sql`${agents.clerkUserId} LIKE 'INVITE\\_%' OR ${agents.clerkUserId} LIKE 'SEED\\_%'`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Distinct emails of a workspace's agents (owner + any invited teammates). */
export async function listAgentEmails(workspaceId: number): Promise<string[]> {
  const rows = await db
    .select({ email: agents.email })
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId));
  return [...new Set(rows.map((r) => r.email.toLowerCase()))];
}

/** Any agent row (real or pending invite) with this email, case-insensitive. */
export async function getAgentByEmail(email: string): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(sql`lower(${agents.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return rows[0] ?? null;
}

// ── Contacts ─────────────────────────────────────────────────────

/** Insert a contact the first time we see (workspace, email). */
export async function upsertContact(
  workspaceId: number,
  name: string,
  email: string,
) {
  await db
    .insert(contacts)
    .values({ workspaceId, name, email: email.toLowerCase() })
    .onConflictDoNothing();
}

export type ContactWithCount = {
  id: number;
  name: string;
  email: string;
  firstSeen: Date;
  ticketCount: number;
};

/** A workspace's contacts, newest first, with how many tickets each has. */
export async function listContactsWithCounts(
  workspaceId: number,
): Promise<ContactWithCount[]> {
  return db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      firstSeen: contacts.firstSeen,
      ticketCount: sql<number>`(
        SELECT count(*)::int FROM tickets t
        WHERE t.workspace_id = ${workspaceId}
          AND t.customer_email = ${contacts.email}
      )`,
    })
    .from(contacts)
    .where(eq(contacts.workspaceId, workspaceId))
    .orderBy(desc(contacts.firstSeen));
}

// ── Ticket reads (always scoped to a workspace) ──────────────────

export const TICKETS_PAGE_SIZE = 50;

/** A single ticket — returns null if it isn't in this workspace. */
export async function getTicket(
  workspaceId: number,
  ticketId: number,
): Promise<Ticket | null> {
  const rows = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The latest `limit` messages of a ticket in chronological order, plus
 * whether older ones were cut off (very long threads stay renderable).
 */
export async function getMessages(
  ticketId: number,
  limit = 200,
): Promise<{ messages: TicketMessage[]; hasMore: boolean }> {
  const rows = await db
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(desc(ticketMessages.sentAt), desc(ticketMessages.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse(), hasMore };
}

// ── GDPR data export ─────────────────────────────────────────────

export type WorkspaceExport = {
  exportedAt: string;
  workspace: {
    name: string;
    inboundEmail: string;
    createdAt: Date | null;
  };
  tickets: {
    id: number;
    source: TicketSource;
    orderId: string | null;
    customerName: string;
    customerEmail: string;
    subject: string;
    status: TicketStatus;
    createdAt: Date | null;
    updatedAt: Date | null;
  }[];
  messages: {
    id: number;
    ticketId: number;
    direction: MessageDirection;
    body: string;
    sentAt: Date | null;
  }[];
  contacts: {
    name: string;
    email: string;
    firstSeen: Date | null;
  }[];
};

/**
 * Everything a workspace holds about its customers, for the data-portability
 * right the privacy policy promises.
 *
 * Deliberately omits credentials and internal security material — the API key
 * and per-ticket reply tokens are not the customer's personal data, and an
 * export is a file that gets emailed around. Columns are listed explicitly
 * rather than `select()`ing whole rows, so a future column can't leak into
 * exports just by existing.
 */
export async function exportWorkspaceData(
  workspaceId: number,
): Promise<WorkspaceExport | null> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return null;

  const [ticketRows, messageRows, contactRows] = await Promise.all([
    db
      .select({
        id: tickets.id,
        source: tickets.source,
        orderId: tickets.orderId,
        customerName: tickets.customerName,
        customerEmail: tickets.customerEmail,
        subject: tickets.subject,
        status: tickets.status,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .where(eq(tickets.workspaceId, workspaceId))
      .orderBy(asc(tickets.id)),

    // Messages have no workspace column of their own — they inherit tenancy
    // through their ticket, so the join IS the tenant filter here.
    db
      .select({
        id: ticketMessages.id,
        ticketId: ticketMessages.ticketId,
        direction: ticketMessages.direction,
        body: ticketMessages.body,
        sentAt: ticketMessages.sentAt,
      })
      .from(ticketMessages)
      .innerJoin(tickets, eq(ticketMessages.ticketId, tickets.id))
      .where(eq(tickets.workspaceId, workspaceId))
      .orderBy(asc(ticketMessages.ticketId), asc(ticketMessages.sentAt)),

    db
      .select({
        name: contacts.name,
        email: contacts.email,
        firstSeen: contacts.firstSeen,
      })
      .from(contacts)
      .where(eq(contacts.workspaceId, workspaceId))
      .orderBy(asc(contacts.id)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    workspace: {
      name: workspace.name,
      inboundEmail: workspace.inboundEmail,
      createdAt: workspace.createdAt,
    },
    tickets: ticketRows,
    messages: messageRows,
    contacts: contactRows,
  };
}

// ── Ticket writes ────────────────────────────────────────────────

export async function createTicket(input: {
  workspaceId: number;
  source: TicketSource;
  orderId?: string | null;
  customerName: string;
  customerEmail: string;
  subject: string;
  body: string;
  direction?: MessageDirection;
  /** Email Message-ID of the originating email, when the source is email. */
  messageId?: string | null;
}): Promise<Ticket> {
  const [ticket] = await db
    .insert(tickets)
    .values({
      workspaceId: input.workspaceId,
      source: input.source,
      replyToken: generateReplyToken(),
      orderId: input.orderId ?? null,
      customerName: input.customerName,
      customerEmail: input.customerEmail.toLowerCase(),
      subject: input.subject,
      status: "open",
    })
    .returning();

  await db.insert(ticketMessages).values({
    ticketId: ticket.id,
    direction: input.direction ?? "inbound",
    body: input.body,
    messageId: input.messageId ?? null,
  });

  return ticket;
}

/** Append a message and bump the ticket's last-activity time. */
export async function addMessage(input: {
  ticketId: number;
  direction: MessageDirection;
  body: string;
  /** Optional new status to set atomically (e.g. reopen on inbound reply). */
  status?: TicketStatus;
  /** Email Message-ID (ours for outbound, the sender's for inbound). */
  messageId?: string | null;
  /**
   * True only when WE generated the message rather than a human — currently
   * just the auto-acknowledgement. Defaults to false, so every caller that
   * doesn't say otherwise records a human send, which is what the auto-reply
   * guard reads as "a teammate already answered".
   */
  automated?: boolean;
}): Promise<TicketMessage> {
  const [message] = await db
    .insert(ticketMessages)
    .values({
      ticketId: input.ticketId,
      direction: input.direction,
      body: input.body,
      messageId: input.messageId ?? null,
      automated: input.automated ?? false,
    })
    .returning();

  await db
    .update(tickets)
    .set({
      // DB clock, not app clock — mixing the two skews inbox ordering.
      updatedAt: sql`now()`,
      ...(input.status ? { status: input.status } : {}),
    })
    .where(eq(tickets.id, input.ticketId));

  return message;
}

/** Update status — scoped to the workspace so cross-tenant writes fail. */
export async function setTicketStatus(
  workspaceId: number,
  ticketId: number,
  status: TicketStatus,
): Promise<Ticket | null> {
  const [updated] = await db
    .update(tickets)
    .set({ status, updatedAt: sql`now()` })
    .where(and(eq(tickets.id, ticketId), eq(tickets.workspaceId, workspaceId)))
    .returning();
  return updated ?? null;
}

// ── Per-agent state: stars and read receipts ─────────────────────

/**
 * Stars and read receipts belong to a PERSON, not to a workspace: my starred
 * inbox is mine, and a ticket a colleague has read is still unread for me.
 * Both tables key on `agent_id`, so every one of these calls needs the agent
 * row for the signed-in user *in the workspace being viewed*.
 *
 * Neither table carries a workspace_id, so tenancy comes from their parents.
 * As in lib/labels.ts, the workspace predicate is written INTO the mutating
 * statement (INSERT … SELECT FROM tickets WHERE workspace_id = $ws) rather
 * than performed as a separate check first.
 */

/**
 * The agent row for this Clerk user **within this workspace**, or null.
 *
 * The workspace match is the important half. `agents.clerk_user_id` is unique
 * globally, so a user who is a client of workspace A and is later made an
 * operator can still resolve to an agent row — but that row belongs to A, and
 * using it while they are viewing workspace B would write A's agent id onto
 * B's tickets. Filtering on workspaceId makes that return null instead.
 *
 * A super-admin viewing a client therefore has no agent id at all, and gets no
 * personal state. That is a real limitation, not an oversight: there is no
 * column that could hold "admin 3's stars inside workspace 12", and inventing
 * an agent row for them would put them into notification and owner lookups
 * that read the agents table.
 */
export async function getWorkspaceAgentId(
  workspaceId: number,
  clerkUserId: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.clerkUserId, clerkUserId),
        eq(agents.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Star or unstar a ticket for one agent. Presence of the row is the star.
 * Returns the new state, or null when the ticket isn't in `workspaceId`.
 */
export async function setTicketStar(
  workspaceId: number,
  ticketId: number,
  agentId: number,
  starred: boolean,
): Promise<boolean | null> {
  if (starred) {
    const res = await db.execute(sql`
      INSERT INTO ticket_stars (ticket_id, agent_id)
      SELECT t.id, ${agentId}
      FROM tickets t
      WHERE t.id = ${ticketId} AND t.workspace_id = ${workspaceId}
      ON CONFLICT (ticket_id, agent_id) DO UPDATE
        SET created_at = ticket_stars.created_at
      RETURNING ticket_id
    `);
    // DO UPDATE, not DO NOTHING: an already-starred ticket must still return a
    // row, or "starred twice" would look like "not your ticket".
    return res.rows.length > 0 ? true : null;
  }

  const res = await db.execute(sql`
    DELETE FROM ticket_stars s
    USING tickets t
    WHERE s.ticket_id = t.id
      AND s.ticket_id = ${ticketId}
      AND s.agent_id = ${agentId}
      AND t.workspace_id = ${workspaceId}
    RETURNING s.ticket_id
  `);
  if (res.rows.length > 0) return false;
  // Nothing removed — was it already unstarred, or not ours at all?
  const owned = await getTicket(workspaceId, ticketId);
  return owned ? false : null;
}

/**
 * Record that this agent has seen everything on this ticket up to now.
 * Idempotent; safe to call on every thread render.
 */
export async function markTicketRead(
  workspaceId: number,
  ticketId: number,
  agentId: number,
): Promise<boolean> {
  const res = await db.execute(sql`
    INSERT INTO ticket_reads (ticket_id, agent_id, last_read_at)
    SELECT t.id, ${agentId}, now()
    FROM tickets t
    WHERE t.id = ${ticketId} AND t.workspace_id = ${workspaceId}
    ON CONFLICT (ticket_id, agent_id) DO UPDATE SET last_read_at = now()
    RETURNING ticket_id
  `);
  return res.rows.length > 0;
}

/**
 * Put a ticket back into this agent's unread pile. Deleting the receipt is the
 * whole mechanism: unread is "no row, or an inbound message newer than the
 * row", so removing it restores the state the ticket had before it was opened.
 */
export async function markTicketUnread(
  workspaceId: number,
  ticketId: number,
  agentId: number,
): Promise<boolean> {
  await db.execute(sql`
    DELETE FROM ticket_reads r
    USING tickets t
    WHERE r.ticket_id = t.id
      AND r.ticket_id = ${ticketId}
      AND r.agent_id = ${agentId}
      AND t.workspace_id = ${workspaceId}
  `);
  const owned = await getTicket(workspaceId, ticketId);
  return owned !== null;
}
