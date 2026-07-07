import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Multi-tenant schema. Every tenant-owned row carries `workspaceId`.
 * Queries in the dashboard MUST always filter by the authenticated
 * user's workspace — never trust an id from the client alone.
 */

export type TicketSource = "contact_form" | "email" | "order";
export type TicketStatus = "open" | "in_progress" | "closed";
export type MessageDirection = "inbound" | "outbound";

export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Public identifier used by the ingestion endpoint, e.g. "cli_abc123".
  apiKey: text("api_key").notNull().unique(),
  // Address clients forward their mail to, e.g. "bakery@inbound.yourapp.com".
  inboundEmail: text("inbound_email").notNull().unique(),
  // Address replies are sent *from* (the client's own address).
  sendingEmail: text("sending_email").notNull(),
  // Accent scheme key (see lib/theme). Cosmetic only.
  accent: text("accent").notNull().default("terracotta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    source: text("source").$type<TicketSource>().notNull(),
    // Only set for source = "order".
    orderId: text("order_id"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    subject: text("subject").notNull(),
    status: text("status").$type<TicketStatus>().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Bumped whenever a message is added — used to sort the inbox.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("tickets_workspace_idx").on(t.workspaceId, t.updatedAt)],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    direction: text("direction").$type<MessageDirection>().notNull(),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.sentAt)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One contact per (workspace, email).
    uniqueIndex("contacts_workspace_email_idx").on(t.workspaceId, t.email),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email").notNull(),
  },
  (t) => [index("agents_workspace_idx").on(t.workspaceId)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Agent = typeof agents.$inferSelect;
