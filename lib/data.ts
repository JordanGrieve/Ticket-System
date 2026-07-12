import { cache } from "react";
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

// ── Ticket reads (always scoped to a workspace) ──────────────────

// Wrapped in React cache() so the dashboard layout (which needs counts) and the
// inbox page (which needs the list) share a single query per request instead of
// hitting the database twice for the same workspace.
export const listTickets = cache(
  async (workspaceId: number): Promise<Ticket[]> => {
    return db
      .select()
      .from(tickets)
      .where(eq(tickets.workspaceId, workspaceId))
      .orderBy(desc(tickets.updatedAt));
  },
);

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

export async function getMessages(ticketId: number): Promise<TicketMessage[]> {
  return db
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(ticketMessages.sentAt);
}

// ── Ticket writes ────────────────────────────────────────────────

/** Per-ticket reply-address secret (8 hex chars). */
function generateReplyToken(): string {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
}): Promise<TicketMessage> {
  const [message] = await db
    .insert(ticketMessages)
    .values({
      ticketId: input.ticketId,
      direction: input.direction,
      body: input.body,
      messageId: input.messageId ?? null,
    })
    .returning();

  await db
    .update(tickets)
    .set({
      updatedAt: new Date(),
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
    .set({ status, updatedAt: new Date() })
    .where(and(eq(tickets.id, ticketId), eq(tickets.workspaceId, workspaceId)))
    .returning();
  return updated ?? null;
}
