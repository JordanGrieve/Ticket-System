import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Multi-tenant schema. Every tenant-owned row carries `workspaceId`.
 * Queries in the dashboard MUST always filter by the authenticated
 * user's workspace — never trust an id from the client alone.
 *
 * Join/child tables (ticket_messages, list_subscribers, campaign_recipients,
 * ticket_labels, ticket_stars, ticket_reads, attachments) deliberately have no
 * workspaceId: they inherit tenancy through their parent row, so queries must
 * join up to the parent and filter there.
 */

export type TicketSource = "contact_form" | "email" | "order";
export type TicketStatus = "open" | "in_progress" | "closed";
export type MessageDirection = "inbound" | "outbound";
/**
 * Delivery state of an *outbound* ticket message, driven by provider webhooks.
 * Null on inbound messages — we never "deliver" those.
 */
export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed";

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
    // Secret embedded in the per-ticket reply address
    // (ticket+TKT-<id>-<token>@…). Ticket ids are sequential, so without
    // this anyone could email messages into other tenants' tickets.
    replyToken: text("reply_token"),
    // Only set for source = "order".
    orderId: text("order_id"),
    // Which contact form this arrived through. Null for email/order tickets and
    // for form_contact tickets taken before a workspace defined named forms.
    formId: integer("form_id").references(() => forms.id, {
      onDelete: "set null",
    }),
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
  (t) => [
    index("tickets_workspace_idx").on(t.workspaceId, t.updatedAt),
    // "Show me everything that came through this form."
    index("tickets_form_idx").on(t.formId),
  ],
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
    // RFC 5322 Message-ID (with angle brackets) — ours for outbound sends,
    // the sender's for inbound email. Lets replies set In-Reply-To/References
    // so mail clients thread the conversation instead of starting new emails.
    messageId: text("message_id"),
    // Outbound only — advanced by provider webhooks. Null means "not
    // applicable" (inbound), NOT "unknown", so don't default it.
    deliveryStatus: text("delivery_status").$type<DeliveryStatus>(),
    /**
     * Did WE compose this, or did a human? Today only the auto-acknowledgement
     * sets it (see lib/auto-reply-send.ts).
     *
     * Without this column an auto-reply and an agent's reply are the same
     * thing — two outbound rows — so the auto-reply guard has to suppress on
     * *any* outbound message, and autoReplies.skipIfTeammateReplied cannot
     * mean anything. With it, "we already acknowledged" and "a teammate
     * already answered" are separate questions with separate answers.
     *
     * Defaulted false, not nullable: "we don't know" is not a state the guard
     * could act on, and every write path now states which it is. Rows that
     * predate the column therefore read as human-sent. That is the same
     * suppression they already produced while skipIfTeammateReplied is on;
     * with it off it would in principle permit a second acknowledgement, but
     * an auto-reply is only ever evaluated at ticket CREATION, so no ticket
     * old enough to hold a pre-migration row is ever asked again.
     */
    automated: boolean("automated").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ticket_messages_ticket_idx").on(t.ticketId, t.sentAt),
    // The inbox's unread anchor: max(sent_at) over one ticket's INBOUND
    // messages. Both equality columns lead so the aggregated one is last and
    // ordered within them — Postgres takes the max off the end of the index
    // instead of walking the whole (ticket_id, sent_at) range discarding
    // outbound rows. Column order is the whole point here; ticket_id first
    // because it is also the only prefix the other reads share.
    index("ticket_messages_ticket_direction_idx").on(
      t.ticketId,
      t.direction,
      t.sentAt,
    ),
    // Dedupe lookups: inbound webhook retries are matched by Message-ID.
    index("ticket_messages_message_id_idx").on(t.messageId),
  ],
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

/**
 * Postbox super-admins (the SaaS operators — NOT tenant clients). Matched by
 * email at login: an admin sees every workspace and can act within any of
 * them. Admins are not tied to a workspace. New admins are added by an
 * existing admin from the /admin screen; the first one is seeded (db/bootstrap).
 */
export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  // Always stored lower-cased; compared against the Clerk primary email.
  email: text("email").notNull().unique(),
  // Filled in the first time this admin signs in (audit only).
  clerkUserId: text("clerk_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * How an impersonation session stopped. There is deliberately no "unknown" —
 * an unfinished session is `endedAt IS NULL`, which is a different statement
 * from "it ended and we don't know how". See the note on endedAt below.
 */
export type ImpersonationEnd =
  // The operator clicked "Stop impersonating".
  | "stopped"
  // They opened a different client, which ends the previous session.
  | "switched"
  // The workspace was deleted out from under them.
  | "workspace_deleted"
  // Their admin access was revoked while they were inside a client.
  | "admin_removed";

/**
 * Every occasion a Postbox operator acted inside a client workspace.
 *
 * The client is the GDPR data controller and we are the processor, so this
 * table is the answer to "did anyone at Postbox read my customers' data, when,
 * and why". It is append-only in spirit: rows are inserted on entry and closed
 * on exit, and nothing in the admin console can delete one.
 *
 * ── Why identity is frozen as text ──
 * `adminId` and `workspaceId` are nullable and "set null", never cascade —
 * same reasoning as campaignRecipients. Removing an admin or deleting a client
 * must not erase the record that they read that client's data; "we deleted the
 * proof" is not an answer to a regulator. `adminEmail` and `workspaceName` are
 * copied at start time and carry the row forward once the FKs go null.
 *
 * ── Why endedAt is not enough ──
 * Nothing forces an operator to leave cleanly. They can close the tab, lose the
 * session cookie, or simply walk away, and no request ever arrives to write
 * endedAt. A schema that only had startedAt/endedAt would leave those sessions
 * open forever and imply unbounded access. So `lastSeenAt` is refreshed
 * (throttled) on every request made while the impersonation cookie is live: for
 * an abandoned session it is the last moment we can honestly claim the operator
 * was still in there. endedAt stays null — we do NOT backfill it from
 * lastSeenAt, because "they left at 14:32" and "we last saw them at 14:32" are
 * different claims and only one of them is true.
 */
export const impersonationSessions = pgTable(
  "impersonation_sessions",
  {
    id: serial("id").primaryKey(),
    // Nullable + frozen email below: see the header note.
    adminId: integer("admin_id").references(() => admins.id, {
      onDelete: "set null",
    }),
    adminEmail: text("admin_email").notNull(),
    // The Clerk identity that actually held the browser session. Null when the
    // admin row was never linked (admins.clerkUserId is itself nullable).
    adminClerkUserId: text("admin_clerk_user_id"),
    workspaceId: integer("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    workspaceName: text("workspace_name").notNull(),
    // Free text the operator typed before entering. Optional, and never
    // invented — null means they gave no reason, which is itself worth showing.
    reason: text("reason"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Heartbeat, not a guess. Bounds the access window for abandoned sessions.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Null = never closed cleanly. Read it with lastSeenAt, not instead of it.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason").$type<ImpersonationEnd>(),
  },
  (t) => [
    // The question a client asks: "who has been in my workspace?"
    index("impersonation_sessions_workspace_idx").on(t.workspaceId, t.startedAt),
    // The question we ask: one operator's history — and, on the adminId prefix,
    // "does this operator already have a session open?"
    index("impersonation_sessions_admin_idx").on(t.adminId, t.startedAt),
    // The console's log view, newest first across every workspace.
    index("impersonation_sessions_started_idx").on(t.startedAt),
  ],
);

// ── Support-desk extras ──────────────────────────────────────────

export type LabelColor = "tag_a" | "tag_b" | "tag_c";

/**
 * Coloured tags on tickets. `color` is a design-token key resolved in
 * lib/theme against the workspace accent — never a hex value, so labels keep
 * working when the accent scheme changes.
 */
export const labels = pgTable(
  "labels",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").$type<LabelColor>().notNull().default("tag_a"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One label name per workspace; also the sidebar listing order source.
    uniqueIndex("labels_workspace_name_idx").on(t.workspaceId, t.name),
  ],
);

export const ticketLabels = pgTable(
  "ticket_labels",
  {
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    labelId: integer("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite PK doubles as the uniqueness guarantee — and gives Postgres a
    // replica identity, which a bare unique index would not.
    primaryKey({ columns: [t.ticketId, t.labelId] }),
    // Filtering the inbox down to one label.
    index("ticket_labels_label_idx").on(t.labelId),
  ],
);

/**
 * Starring is PER AGENT, not per workspace — my starred inbox is mine alone.
 * Presence of the row is the star; unstarring deletes it.
 */
export const ticketStars = pgTable(
  "ticket_stars",
  {
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.agentId] }),
    // "My starred tickets", newest first.
    index("ticket_stars_agent_idx").on(t.agentId, t.createdAt),
  ],
);

/**
 * Per-agent unread tracking. A ticket is unread for an agent when there is no
 * row, or when `tickets.updatedAt > lastReadAt` — so we never have to write a
 * row per message, only per agent per ticket.
 */
export const ticketReads = pgTable(
  "ticket_reads",
  {
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.agentId] }),
    // Unread badge counts scan one agent's rows.
    index("ticket_reads_agent_idx").on(t.agentId),
  ],
);

/**
 * Files hanging off a ticket message. Bytes live in object storage; the DB only
 * ever holds the pointer (`storageKey`) plus enough metadata to render a chip.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => ticketMessages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    // Object-storage path. Unguessable and unique — it is the only handle we
    // have on the blob, and deleting the row orphans it.
    storageKey: text("storage_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attachments_message_idx").on(t.messageId)],
);

/**
 * Named contact forms. A workspace can run several (Support, Sales, Returns…)
 * and route each to the same inbox with different framing. `key` is the public
 * identifier posted by the embed snippet, so it must be unguessable — generate
 * with generateFormKey() from lib/tokens.
 */
export const forms = pgTable(
  "forms",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Nullable: a form can exist in the dashboard before it is published.
    key: text("key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("forms_workspace_idx").on(t.workspaceId),
    // Public ingestion looks the form up by key alone, so it is globally
    // unique rather than unique-per-workspace.
    uniqueIndex("forms_key_idx").on(t.key),
  ],
);

export type AutoReplyDelay = "immediate" | "5min" | "1hr";
export type AutoReplySchedule = "always" | "business_hours" | "out_of_hours";

/**
 * Business-hours window, stored whole because it is only ever read as a unit.
 * `days` is 0=Sunday … 6=Saturday; times are "HH:MM" in `timezone`.
 */
export type BusinessHours = {
  days: number[];
  start: string;
  end: string;
};

/**
 * Auto-acknowledgement settings — at most one row per workspace (enforced by
 * the unique index, so upsert on workspaceId).
 */
export const autoReplies = pgTable(
  "auto_replies",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    // Sent instead of `body` outside business hours. Null = use `body`.
    outOfHoursBody: text("out_of_hours_body"),
    delay: text("delay").$type<AutoReplyDelay>().notNull().default("immediate"),
    scheduleMode: text("schedule_mode")
      .$type<AutoReplySchedule>()
      .notNull()
      .default("always"),
    businessHours: jsonb("business_hours").$type<BusinessHours>(),
    // IANA zone the businessHours window is evaluated in. Meaningless to store
    // 09:00–17:00 without it.
    timezone: text("timezone").notNull().default("UTC"),
    // With a non-immediate delay a human may beat the robot to it; when set we
    // drop the queued auto-reply rather than talk over the agent.
    skipIfTeammateReplied: boolean("skip_if_teammate_replied")
      .notNull()
      .default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("auto_replies_workspace_idx").on(t.workspaceId)],
);

// ── Mailer ───────────────────────────────────────────────────────

export type SubscriberStatus =
  | "subscribed"
  | "unsubscribed"
  | "bounced"
  | "complained";

/** How consent was captured. Recorded for every subscriber — see below. */
export type ConsentMethod =
  | "signup_form"
  | "checkout"
  | "api"
  | "import"
  | "manual";

/**
 * Marketing audience. Deliberately NOT `contacts`: a contact is someone who
 * raised a support ticket and has given us no marketing permission whatsoever.
 * Sending to contacts would be unlawful in most of our markets, so the two
 * tables never merge and there is no FK between them — the same human may
 * legitimately exist in both, and the subscribers row is the only one that
 * carries permission to market to them.
 */
export const subscribers = pgTable(
  "subscribers",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    status: text("status")
      .$type<SubscriberStatus>()
      .notNull()
      .default("subscribed"),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    // Where the address came from, e.g. "footer_form", "shopify_import".
    source: text("source"),
    // ── Consent provenance ──
    // Kept separate from subscribedAt because they answer different questions:
    // subscribedAt is "since when are they on the list", consentAt is "what can
    // we show a regulator". Never backfill these on import — an import with no
    // provenance is an import we cannot lawfully send to.
    consentMethod: text("consent_method").$type<ConsentMethod>(),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    // Free-text evidence: the URL of the form, the checkbox wording shown, or
    // the name of the file the addresses were imported from.
    consentSource: text("consent_source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One subscriber per (workspace, email) — mirrors contacts.
    uniqueIndex("subscribers_workspace_email_idx").on(t.workspaceId, t.email),
    // Audience listings and "how many can we actually mail" counts.
    index("subscribers_workspace_status_idx").on(t.workspaceId, t.status),
  ],
);

/** Named audience list. Membership lives in listSubscribers. */
export const lists = pgTable(
  "lists",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("lists_workspace_name_idx").on(t.workspaceId, t.name)],
);

export const listSubscribers = pgTable(
  "list_subscribers",
  {
    listId: integer("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    subscriberId: integer("subscriber_id")
      .notNull()
      .references(() => subscribers.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Adding the same subscriber twice is a no-op, not a duplicate send.
    primaryKey({ columns: [t.listId, t.subscriberId] }),
    // "Which lists is this person on" (shown on the subscriber detail page).
    index("list_subscribers_subscriber_idx").on(t.subscriberId),
  ],
);

export type SuppressionReason = "hard_bounce" | "complaint" | "manual";

/**
 * Workspace-wide hard block, keyed by email rather than subscriber id so it
 * still bites for an address that was deleted and re-added, or that never got
 * a subscribers row. Every send MUST left-join this table and skip any hit,
 * regardless of list membership or subscriber status.
 */
export const suppressions = pgTable(
  "suppressions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    reason: text("reason").$type<SuppressionReason>().notNull(),
    // Why a human added it, or the provider's bounce diagnostic.
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One block per address; re-suppressing is an upsert.
    uniqueIndex("suppressions_workspace_email_idx").on(t.workspaceId, t.email),
  ],
);

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed";

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Internal name shown in the campaigns table; `subject` is what recipients see.
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    // Inbox preview line after the subject.
    preheader: text("preheader"),
    // Layout key resolved in lib/email templates, not stored HTML.
    templateKey: text("template_key").notNull(),
    body: text("body").notNull(),
    // Audience. Nullable so a draft can exist before an audience is chosen;
    // "set null" keeps a sent campaign's history when its list is deleted.
    listId: integer("list_id").references(() => lists.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Snapshot of how many recipient rows were materialised at send time. A
    // cached count for the listing UI — campaignRecipients is the truth.
    recipientCount: integer("recipient_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("campaigns_workspace_status_idx").on(t.workspaceId, t.status),
    // The scheduler sweeps status = "scheduled" by due time.
    index("campaigns_scheduled_idx").on(t.status, t.scheduledAt),
  ],
);

export type RecipientStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed";

/**
 * Per-recipient send log — and the thing that makes a retry safe.
 *
 * The send is two phases:
 *  1. Materialise the audience in one transaction: INSERT … ON CONFLICT
 *     (campaign_id, subscriber_id) DO NOTHING, every row "queued". Re-running
 *     this after a crash adds only rows that were missing.
 *  2. The worker claims each row with
 *       UPDATE … SET status = 'sent', sent_at = now(), attempts = attempts + 1
 *       WHERE id = $1 AND status = 'queued' RETURNING id
 *     and only calls the provider if that returned a row. A concurrent or
 *     retried worker gets zero rows and sends nothing.
 *
 * So the unique index is the idempotency key and `status` is the claim latch.
 * Note this is claim-before-send: a crash between the UPDATE and the provider
 * call loses that email rather than duplicating it. Losing one beats mailing
 * someone twice, but it does mean stuck rows need a reconciliation sweep by
 * providerMessageId.
 */
export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    // Nullable, and deliberately NOT cascading. Deleting a subscriber must not
    // erase the record of what was sent to them: the bounce and complaint rows
    // here are the evidence you need in a deliverability or GDPR dispute, and
    // "we deleted the proof when they asked to be forgotten" is not a defence.
    // The frozen `email` below carries the log forward once this goes null.
    subscriberId: integer("subscriber_id").references(() => subscribers.id, {
      onDelete: "set null",
    }),
    // Address frozen at materialisation time: if the subscriber later edits
    // their email, the log must still say where this send actually went. This
    // is also what keeps an orphaned row (subscriber deleted) meaningful.
    email: text("email").notNull(),
    status: text("status").$type<RecipientStatus>().notNull().default("queued"),
    // Per-recipient secret in the List-Unsubscribe URL. Must be unguessable —
    // generate with generateUnsubscribeToken() from lib/tokens — otherwise
    // anyone could unsubscribe anyone.
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
    // Provider id, used to match delivery/bounce webhooks back to this row.
    providerMessageId: text("provider_message_id"),
    // Incremented by the claim UPDATE; > 1 means a retry touched this row.
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Provider's failure reason, kept for the campaign report.
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Idempotency key: one row per (campaign, subscriber), ever. Postgres
    // permits many NULLs in a unique index, so this stops enforcing once a
    // subscriber is deleted — acceptable, because the constraint only has to
    // hold while the campaign is materialising, and a deleted subscriber is
    // never re-materialised into an already-sent campaign.
    uniqueIndex("campaign_recipients_campaign_subscriber_idx").on(
      t.campaignId,
      t.subscriberId,
    ),
    // The worker pulls the next "queued" batch for a campaign; the report
    // counts by status over the same index.
    index("campaign_recipients_campaign_status_idx").on(t.campaignId, t.status),
    // Webhook lookups.
    index("campaign_recipients_provider_message_id_idx").on(
      t.providerMessageId,
    ),
    // "Everything we ever sent this person."
    index("campaign_recipients_subscriber_idx").on(t.subscriberId),
  ],
);

export type DomainVerificationStatus = "pending" | "verified" | "failed";

/**
 * Custom sending domain. Each auth mechanism verifies independently — SPF and
 * DKIM can pass while DMARC is still missing — so they get a column each
 * rather than one rolled-up state.
 */
export const sendingDomains = pgTable(
  "sending_domains",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    // DNS selector for the DKIM TXT record we ask the client to publish.
    dkimSelector: text("dkim_selector"),
    spfStatus: text("spf_status")
      .$type<DomainVerificationStatus>()
      .notNull()
      .default("pending"),
    dkimStatus: text("dkim_status")
      .$type<DomainVerificationStatus>()
      .notNull()
      .default("pending"),
    dmarcStatus: text("dmarc_status")
      .$type<DomainVerificationStatus>()
      .notNull()
      .default("pending"),
    // Null until the first DNS check runs.
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sending_domains_workspace_domain_idx").on(
      t.workspaceId,
      t.domain,
    ),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Admin = typeof admins.$inferSelect;
export type ImpersonationSession = typeof impersonationSessions.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type TicketLabel = typeof ticketLabels.$inferSelect;
export type TicketStar = typeof ticketStars.$inferSelect;
export type TicketRead = typeof ticketReads.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Form = typeof forms.$inferSelect;
export type AutoReply = typeof autoReplies.$inferSelect;
export type Subscriber = typeof subscribers.$inferSelect;
export type List = typeof lists.$inferSelect;
export type ListSubscriber = typeof listSubscribers.$inferSelect;
export type Suppression = typeof suppressions.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type SendingDomain = typeof sendingDomains.$inferSelect;
