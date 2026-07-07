import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  workspaces,
  tickets,
  ticketMessages,
  contacts,
  type Ticket,
  type TicketMessage,
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

export async function listTickets(workspaceId: number): Promise<Ticket[]> {
  return db
    .select()
    .from(tickets)
    .where(eq(tickets.workspaceId, workspaceId))
    .orderBy(desc(tickets.updatedAt));
}

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

export async function createTicket(input: {
  workspaceId: number;
  source: TicketSource;
  orderId?: string | null;
  customerName: string;
  customerEmail: string;
  subject: string;
  body: string;
  direction?: MessageDirection;
}): Promise<Ticket> {
  const [ticket] = await db
    .insert(tickets)
    .values({
      workspaceId: input.workspaceId,
      source: input.source,
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
}): Promise<TicketMessage> {
  const [message] = await db
    .insert(ticketMessages)
    .values({
      ticketId: input.ticketId,
      direction: input.direction,
      body: input.body,
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
