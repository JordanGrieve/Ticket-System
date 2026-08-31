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
  // ── CAN-SPAM identification. NOT cosmetic, and NOT optional at send time ──
  //
  // `name` above is a display label the client picked ("Bakery"); these two are
  // the legal identification of the sender, and a marketing message that omits
  // the postal one is unlawful — 15 U.S.C. §7704(a)(5) requires a valid
  // physical postal address in EVERY commercial message, and the equivalent
  // identification duty exists under PECR and the GDPR. It is a per-message
  // requirement, not a "have it on the website somewhere" requirement, which is
  // why it has to be a column the renderer can read rather than a setting.
  //
  // Both are NULLABLE ON PURPOSE, and nullable is the safety property here.
  // A NOT NULL with a default would hand every existing live workspace a
  // placeholder that LOOKS filled in — and a fake postal address in a real
  // marketing email is worse than no send at all: it is an affirmative
  // falsehood in the one field the statute is about. Null means "no human has
  // supplied this", which is a state the send path can refuse on. Nothing may
  // backfill them, and the draft→send gate must treat null-or-blank as a hard
  // stop rather than rendering an empty line.
  //
  // legalName is the registered/trading entity, which is frequently not `name`
  // ("Ada's Bakery Ltd", not "Bakery"). Separate column because guessing it
  // from the display name is exactly the kind of plausible-looking invention
  // that makes the footer a lie.
  legalName: text("legal_name"),
  // Free text, multi-line. Deliberately unstructured: postal formats differ by
  // country and a normalised address model would reject valid addresses, which
  // in this table means blocking a lawful send.
  postalAddress: text("postal_address"),

  // ── Newsletter branding (PIVOT 42). Cosmetic, and that is a rule ──
  //
  // The two columns above stop a send when they are empty. These two must
  // NEVER do that, and they sit next to each other so the difference is read
  // rather than remembered: identity is a legal duty, branding is decoration.
  // A workspace that has never opened the setting sends a correctly branded
  // Postbox-default newsletter, and lib/newsletter.ts has no code path where
  // an absent colour or sign-off can refuse to render.
  //
  // brandAccentHex is NOT trusted as stored. It reaches a `style` attribute in
  // an email, where there is no cascade to lean on and no fixing it after it
  // is sent, so lib/email-colour.ts re-parses it, forces 4.5:1 against the
  // background it will actually be read on, and re-emits a canonical hex.
  // Anything unparseable becomes the default rather than an error.
  //
  // The header LOGO the design also calls for is deliberately absent. It needs
  // object storage, which does not exist yet; a nullable url column now would
  // be a field nothing could ever fill.
  brandAccentHex: text("brand_accent_hex"),
  brandSignOff: text("brand_sign_off"),

  // ── Billing ──────────────────────────────────────────────────────────
  //
  // Every workspace starts on 'trial'. There is no 'none' and no null: a
  // workspace that exists is always in exactly one billable state, so no
  // caller ever has to decide what an absent plan means.
  //
  // `plan` is what they are ENTITLED to. `subscriptionStatus` is what Stripe
  // last told us. They are separate on purpose — a subscription can be
  // past_due while the customer is still, correctly, entitled to the product
  // through the end of the period they paid for. Collapsing the two would mean
  // a failed card locking somebody out of their own customer mail the same
  // afternoon.
  plan: text("plan").$type<PlanState>().notNull().default("trial"),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  // Stripe's ids. Nullable: a workspace on trial has never met Stripe.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Raw Stripe subscription status: active, past_due, canceled, … */
  subscriptionStatus: text("subscription_status"),
  /**
   * End of the period the customer has actually paid for.
   *
   * This, not `subscriptionStatus`, is what access is judged against once a
   * plan is chosen. Stripe retries a failed card for days; during that window
   * the status is past_due but the paid period has not ended, and cutting
   * access off would be taking something they paid for.
   */
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * What a workspace is entitled to.
 *
 * 'trial' is the starting state; the three paid ids mirror lib/pricing.ts.
 * Deliberately a text column with a TypeScript union rather than a pg enum:
 * adding a plan should not require a migration that locks the table, and the
 * ids here have to stay in step with PLANS, which is checked by a test.
 */
export type PlanState = "trial" | "starter" | "growth" | "business";

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

    // ── Trash ────────────────────────────────────────────────────────
    //
    // Deleting is a SOFT delete for 30 days and then a real one. That is what
    // every mail client the client already uses means by "delete", and in an
    // inbox holding customer correspondence an accidental permanent delete is
    // unrecoverable — somebody loses a customer's enquiry to a stray click.
    //
    // NULL means live. The predicate is `deleted_at IS NULL`, and it is applied
    // in folderWhere() so every folder inherits it from one place; only Trash
    // asks for the opposite. See app/(dashboard)/queries.ts.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * Who deleted it — an email SNAPSHOT, not an agent id.
     *
     * Same reasoning as contact_notes.authorLabel: an id goes null when the
     * teammate is removed, and "deleted by nobody" is exactly the wrong answer
     * to "who deleted our customer's enquiry?". A Postbox operator acting
     * inside the workspace has no agents row at all, and would be
     * indistinguishable from a departed teammate.
     *
     * It dies with the ticket at purge, deliberately. A permanent record that
     * somebody's message existed would defeat the erasure the purge performs.
     */
    deletedBy: text("deleted_by"),

    // ── Archive ──────────────────────────────────────────────────────
    //
    // Distinct from `closed`, and the distinction is the point. Closing says
    // something about the CONVERSATION — it is resolved, the customer got
    // their answer. Archiving says something about the VIEW — get this off my
    // inbox, I am done looking at it. A ticket can be archived and still open
    // (a long-running wholesale negotiation nobody wants cluttering today's
    // list) or closed and unarchived (resolved this morning, still on screen).
    //
    // Collapsing them into `status` would force a false choice: either
    // archiving falsely marks a live conversation resolved, or closing
    // falsely removes a resolved one from a view somebody wanted it in.
    //
    // NULL means not archived.
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    // ── Snooze ───────────────────────────────────────────────────────
    //
    // The time it should come back. NULL means not snoozed.
    //
    // ── THERE IS NO UN-SNOOZE JOB, AND THAT IS DELIBERATE ──
    // Snoozed is DERIVED, not stored: a ticket is snoozed while
    // `snoozed_until > now()` and simply is not, one second later. The
    // predicate is evaluated per query, so the ticket reappears in the inbox
    // on its own with nothing having run.
    //
    // The board scoped this as needing a scheduler, sharing the cron
    // dependency with delayed auto-reply and the impersonation reaper. It does
    // not. A job that flips a boolean at wake time would add a moving part
    // that can be down, be late, or run twice — and its only observable effect
    // would be to reproduce what `snoozed_until > now()` already says. Every
    // minute that job was broken, tickets would stay hidden past their time
    // and nobody would know why.
    //
    // A scheduler DOES have a job here eventually, but a different one:
    // NOTIFYING somebody that a snoozed ticket has woken. That is a message
    // being sent, not a state being computed, and it is the kind of thing a
    // sweep should own. It is not built.
    //
    // Same reasoning as shared links and the onboarding checklist: derive it,
    // do not store a second copy of a fact the first copy already implies.
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    /**
     * Who snoozed it, as an email SNAPSHOT. Same reasoning as deletedBy: an
     * agent id goes null when a teammate leaves, and "snoozed by nobody" is
     * the wrong answer to "why did this vanish from our inbox for a week?".
     */
    snoozedBy: text("snoozed_by"),
  },
  (t) => [
    index("tickets_workspace_idx").on(t.workspaceId, t.updatedAt),
    // "Show me everything that came through this form."
    index("tickets_form_idx").on(t.formId),
    // The purge sweep asks "what is past its 30 days?" across every workspace,
    // and every folder query asks "is this live?". Both are served by this.
    index("tickets_deleted_idx").on(t.deletedAt),
    // Every inbox query now also asks "is this archived?" and "is this still
    // snoozed?". Both are per-workspace questions, so they ride the workspace
    // column rather than standing alone.
    index("tickets_archived_idx").on(t.workspaceId, t.archivedAt),
    index("tickets_snoozed_idx").on(t.workspaceId, t.snoozedUntil),
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
     * The PROVIDER's id for this send — Resend's, not ours.
     *
     * Distinct from `messageId` above, which is the RFC 5322 Message-ID used
     * for threading. This is the correlation key a delivery webhook arrives
     * with, and without it a bounce notification has nothing to match against:
     * the event says "email_id abc123 bounced" and the database has never
     * heard of abc123.
     *
     * That was the state until 23 August 2026 — the id came back from
     * `resend.emails.send()` and was thrown away, so every transactional
     * bounce was unattributable by construction. A reply to a dead address
     * failed and nobody was told.
     *
     * Null for inbound messages, and for outbound ones whose send failed
     * before the provider issued an id.
     */
    providerMessageId: text("provider_message_id"),
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
    uniqueIndex("ticket_messages_provider_idx").on(t.providerMessageId),
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

/**
 * Internal notes a team writes about a customer. Never shown to the customer.
 *
 * KEYED BY EMAIL, NOT contact_id. A ticket can exist with no `contacts` row at
 * all — contacts were added to this product later, and getContactFacts already
 * has a fallback path for exactly that. Keying notes on contact_id would mean
 * the note box silently failing for the oldest customers, who are precisely the
 * ones somebody has most to say about. (workspace_id, email) is the identity
 * the rail already uses, and `contacts` itself is unique on the same pair.
 *
 * Stored lower-cased, like contacts.email, so "Emma@" and "emma@" are one
 * person rather than two note lists nobody can reconcile.
 *
 * workspace_id is NOT derivable from anything else here and is the tenancy key:
 * every read and every write must constrain on it INSIDE the statement. See
 * tests/tenancy-invariants.test.ts, which has caught that being got wrong.
 *
 * authorAgentId is ON DELETE SET NULL, not cascade: removing somebody from a
 * team must not silently delete the notes they wrote about customers. The note
 * outlives the employment. A null author renders as "a former teammate".
 */
export const contactNotes = pgTable(
  "contact_notes",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contactEmail: text("contact_email").notNull(),
    authorAgentId: integer("author_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    /**
     * Who wrote it, captured AT WRITE TIME and never updated.
     *
     * Redundant with authorAgentId on purpose. The id is null in two entirely
     * different situations — the teammate was removed, and a Postbox operator
     * wrote the note while acting inside the workspace (operators have no
     * agents row here) — and the rail would have no way to tell them apart. It
     * would have to render one of them as the other, and "a former teammate"
     * against a note the support desk wrote is a lie to a paying client about
     * who has been in their account.
     *
     * A snapshot also survives the thing it names: an email that changes later
     * does not rewrite the history of who said what.
     */
    authorLabel: text("author_label").notNull(),
    /** Plain text. Rendered as text, never as HTML. */
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("contact_notes_lookup_idx").on(t.workspaceId, t.contactEmail),
  ],
);

/**
 * Who owns a workspace.
 *
 * There are no permission levels in this product — an invited teammate can read
 * every message, reply as the business and change every setting. That is stated
 * plainly on the invite screen and it is deliberate.
 *
 * What it must NOT mean is that an invitee can remove the person who invited
 * them. Before this column every agent row was equal, so the bakery could invite
 * a part-timer and the part-timer could delete the bakery's owner and keep the
 * inbox. The invite is claimed by email address alone, so that is not even a
 * malicious-insider story: it is one mis-typed address away.
 *
 * 'owner' is therefore about REMOVAL, not about capability. Owners and members
 * can do exactly the same things; an owner simply cannot be removed by someone
 * else. Every workspace has exactly one, backfilled to the earliest agent row.
 */
export type AgentRole = "owner" | "member";

export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email").notNull(),
    // Defaults to 'member' so an invite created by any older code path cannot
    // accidentally mint a second owner.
    role: text("role").$type<AgentRole>().notNull().default("member"),
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
  // They signed out of Postbox entirely while still inside the client. A
  // deliberate exit like "stopped", but they left the building rather than
  // returning to the admin console — worth telling apart in the log, because
  // it is the one case where the session ends without them seeing it end.
  | "signed_out"
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
    /*
     * ── The hash chain: see lib/impersonation-chain.ts ──
     *
     * chainHash is a hash over this row's ENTRY facts (admin, workspace,
     * reason, startedAt) together with chainPrevHash, which is the chainHash
     * of the row appended before it. That makes the table a linked list:
     * delete a row and its successor points at a hash that is not there any
     * more, edit a row and its own hash stops matching it. Neither is visible
     * in the row — lib/impersonation.ts:verifyImpersonationLog walks the whole
     * chain and reports the first place it stops holding together.
     *
     * This is tamper-EVIDENCE, not tamper-resistance. A DATABASE_URL holder
     * can still delete from this table; what changes is that they cannot do it
     * quietly. And only if IMPERSONATION_CHAIN_SECRET is set can they not
     * simply recompute the chain afterwards — the reasoning is in the module.
     *
     * NULL on both columns means the row predates the chain. Those rows are
     * NOT retro-hashed: a backfilled hash would only prove the row says what
     * it says today, which is the one thing in question. Verification counts
     * them and reports them as unverifiable rather than pretending.
     *
     * The mutable columns above (lastSeenAt, endedAt, endedReason) are NOT
     * covered, because a hash cannot cover a value that legitimately changes
     * after the row is written — every heartbeat would invalidate the rest of
     * the chain. Sealing exits needs an event table, and that is not built.
     */
    chainPrevHash: text("chain_prev_hash"),
    chainHash: text("chain_hash"),
  },
  (t) => [
    // The question a client asks: "who has been in my workspace?"
    index("impersonation_sessions_workspace_idx").on(t.workspaceId, t.startedAt),
    // The question we ask: one operator's history — and, on the adminId prefix,
    // "does this operator already have a session open?"
    index("impersonation_sessions_admin_idx").on(t.adminId, t.startedAt),
    // The console's log view, newest first across every workspace.
    index("impersonation_sessions_started_idx").on(t.startedAt),
    /*
     * These two uniques are not a lookup optimisation — they are what makes
     * the chain a chain rather than a tree, and they are enforced by Postgres
     * rather than by the writer remembering to.
     *
     * The append is read-then-write (read the current head hash, insert a row
     * pointing at it), and two operators entering workspaces at the same
     * moment can both read the same head. Without the unique on
     * chain_prev_hash, both would commit and the chain would FORK: two rows
     * claiming the same predecessor, and verification would report a break
     * that nobody caused. With it, the second insert fails on a constraint,
     * retries against the new head, and — because the retry draws a fresh
     * sequence value — lands with both a later id and a later chain position.
     * That is what lets verification walk the chain in id order at all.
     *
     * The unique on chain_hash is the same guard from the other end: two rows
     * with identical hashes would make "which row does this one follow"
     * ambiguous. It is also a cheap trip-wire for the laziest forgery there
     * is, copying an existing row's hashes onto an edited row.
     *
     * Both are nullable-friendly: Postgres does not consider NULLs equal, so
     * every pre-chain row is exempt without any special case.
     */
    uniqueIndex("impersonation_sessions_chain_prev_idx").on(t.chainPrevHash),
    uniqueIndex("impersonation_sessions_chain_hash_idx").on(t.chainHash),
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
    /**
     * A colour the user picked, as #rrggbb, or null to use the token above.
     *
     * ── WHY BOTH COLUMNS ──
     * `color` stores a TOKEN KEY, and that is deliberate: the token resolves to
     * a different hue in each of the five palettes, so one row renders legibly
     * everywhere without a write. lib/labels.ts used to say a colour wheel
     * "would promise a fidelity the schema cannot keep", and against a plain
     * hex column that was true — somebody picking dark navy would produce a
     * label nobody could read on the Ocean theme.
     *
     * This is additive rather than a replacement. Every existing label keeps
     * its token and stays theme-adaptive; only a label somebody has explicitly
     * recoloured carries a hex. Nothing had to be migrated and nothing lost
     * its per-theme behaviour.
     *
     * The readability problem is solved at RENDER rather than by restricting
     * the choice: the chip mixes this colour into the theme's own surface and
     * ink with color-mix, so a dark navy becomes a pale navy tint with dark
     * navy text on a light theme, and a dark navy ground with light navy text
     * on a dark one. The hue is theirs; the contrast is ours.
     */
    colorHex: text("color_hex"),
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
 *
 * ── NOTHING READS OR WRITES THIS YET ──
 * Declared unused on 23 August 2026, and asserted by tests/unused-tables.test.ts
 * so it cannot quietly gain a writer without somebody deciding to.
 *
 * It is UNBUILT, not abandoned — the distinction the schema could not make
 * before, because a table waiting for a feature and a table nobody wants look
 * identical from here. What it is waiting on is object storage, plus answers to
 * the questions in PIVOT 9: where bytes live (S3, and NOT Postgres — the Neon
 * free tier is 0.5 GB), whether files from strangers are virus-scanned before
 * being served back to the business owner, and how long they are kept.
 *
 * The contact rail's "Shared files" row stays disabled until then, because
 * there is genuinely nothing to list.
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

/**
 * Lifecycle of one deferred acknowledgement.
 *
 * `sending` is a claim latch, not a state anyone waits in: the sweep flips
 * `pending → sending` inside the claiming UPDATE, so two overlapping ticks
 * cannot both pick up the same row. A row that dies in `sending` (function
 * killed mid-flight) stays there rather than being retried, which is the safe
 * direction — the cost is one acknowledgement not sent, not one sent twice.
 */
export type AutoReplyQueueStatus =
  | "pending"
  | "sending"
  | "sent"
  | "suppressed"
  | "failed";

/**
 * Deferred auto-acknowledgements — the queue behind "hold it until we're open".
 *
 * ── WHY A TABLE AND NOT A DELAY ──
 *
 * Before this existed, an enquiry that arrived outside a workspace's business
 * hours was simply DROPPED: `decideAutoReply` returned `schedule` and nothing
 * ever revisited it. A customer emailing at 21:00 got the acknowledgement the
 * workspace had configured, paid for and switched on — never. Nobody was told:
 * not the customer, not the client.
 *
 * There is no in-process timer that could have fixed that. This app is
 * serverless; the function that handled the enquiry is gone milliseconds later.
 * A durable row plus the existing scheduled sweep is the only shape that works.
 *
 * ── ONE ROW PER TICKET, FOREVER ──
 *
 * `ticket_id` is UNIQUE, and terminal rows are never deleted by the sweep. That
 * makes enqueueing idempotent (a retried webhook cannot queue a second
 * acknowledgement) and makes "did we already handle this ticket?" answerable
 * from this table alone. It mirrors the one-acknowledgement-per-ticket rule the
 * guard chain already enforces against ticket_messages.
 *
 * ── WHAT IS AND IS NOT STORED ──
 *
 * `headers` is the normalised inbound header map, and it is here for one
 * reason: the automated/bulk guard reads it, and the webhook payload it came
 * from does not survive to the morning. Every OTHER guard input — the config,
 * who has replied since, the rate-limit counters — is deliberately NOT stored,
 * because those must be re-evaluated at SEND time rather than frozen at queue
 * time. The rendered subject and body are not stored either, for the same
 * reason: an edit to the template between 21:00 and 09:00 should be honoured.
 */
export const autoReplyQueue = pgTable(
  "auto_reply_queue",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** The next moment the workspace is open, computed in its own timezone. */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status")
      .$type<AutoReplyQueueStatus>()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Normalised inbound headers — the automated/bulk guard's only input. */
    headers: jsonb("headers").$type<Record<string, string>>(),
    /** Why a row ended where it did: a suppression reason, or a send error. */
    reason: text("reason"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Idempotency: one queued acknowledgement per ticket, ever.
    uniqueIndex("auto_reply_queue_ticket_idx").on(t.ticketId),
    // The sweep's only query: pending rows that are due, oldest first.
    index("auto_reply_queue_due_idx").on(t.status, t.dueAt),
    index("auto_reply_queue_workspace_idx").on(t.workspaceId),
  ],
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
    // The address the consent was submitted from. Part of the same evidence
    // bundle: "someone ticked a box" is worth far less to a regulator than
    // "this address, at this timestamp, from this IP, on this form".
    //
    // Added now, while the table is empty, because a nullable text column on a
    // populated `subscribers` would be a lock on the table clients' signup
    // forms write to. Adding it later costs a maintenance window; adding it
    // today costs nothing.
    //
    // Nullable, and permanently so — not merely "until we backfill". Consent
    // legitimately arrives through channels that have no IP: a CSV import, a
    // till, a phone call, a paper form. NOT NULL would force those paths to
    // write a placeholder, which is inventing evidence.
    //
    // `text`, not `inet`: this stores what the proxy actually handed us,
    // verbatim, as evidence. `inet` would reject a malformed or comma-joined
    // X-Forwarded-For and throw away the record rather than keep an imperfect
    // one — and we never query it by range, only ever read it back on one row.
    consentIp: text("consent_ip"),
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
 *
 * ── NOTHING READS OR WRITES THIS YET ──
 * Declared unused on 23 August 2026, and asserted by tests/unused-tables.test.ts
 * so it cannot quietly gain a writer without somebody deciding to.
 *
 * UNBUILT, not abandoned. This is the table behind "send newsletters from
 * @theirdomain.com instead of ours", which is the ONLY thing in the product
 * that ever requires a client to touch DNS — worth knowing, because clients ask
 * whether they need to and today the answer is no.
 *
 * Today every workspace sends from the platform's own verified subdomain
 * (news.postbox.help), so one reputation carries every tenant's mail. That is
 * simpler and it is the reason a single client's bounce rate is everybody's
 * problem, which is what this table would eventually fix.
 *
 * Blocked on nothing technical — it is unbuilt because SES production access
 * is still pending and there is no point verifying a client's domain against a
 * sandboxed account.
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
/**
 * Rejected attempts at the public ingestion endpoints.
 *
 * WHY: Open Door Bakery’s contact form posted a key that no longer existed for
 * six weeks. Postbox correctly returned 401 to every request and threw the
 * fact away, so nothing anywhere recorded that thousands of attempts had
 * arrived carrying an unknown key. The quiet-workspace detector
 * (lib/workspace-health.ts) infers that problem from an ABSENCE; this records
 * the CAUSE.
 *
 * AGGREGATED, NOT APPENDED. One row per (reason, key_prefix) with a count and
 * first/last seen, upserted. A row-per-request log written by an unauthenticated
 * public endpoint is a free database-growth primitive for anyone who reads the
 * client’s page source — which is exactly what app/api/subscribe/[key] was
 * designed to avoid. The unique constraint bounds this table by DISTINCT KEYS
 * rather than by request volume, which is the property that makes it safe.
 *
 * key_prefix is TRUNCATED: enough to recognise which integration is failing,
 * never enough to replay. And only keys shaped like ours are recorded at all
 * (see lib/ingestion-log.ts) — internet background scanning would otherwise
 * fill this with one row per random string.
 */
export const ingestionFailures = pgTable(
  "ingestion_failures",
  {
    id: serial("id").primaryKey(),
    /** invalid_key | missing_fields | invalid_email | honeypot */
    reason: text("reason").$type<IngestionFailureReason>().notNull(),
    /** First 16 chars of the attempted key. Recognisable, not reusable. */
    keyPrefix: text("key_prefix").notNull(),
    /**
     * Known only when the key WAS valid and the body failed validation. Null
     * for invalid_key — an unknown key belongs to no workspace by definition,
     * and guessing which client it was meant for would be inventing evidence.
     */
    workspaceId: integer("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    count: integer("count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ingestion_failures_reason_key_idx").on(t.reason, t.keyPrefix),
    index("ingestion_failures_last_seen_idx").on(t.lastSeenAt),
  ],
);

export type IngestionFailureReason =
  | "invalid_key"
  | "missing_fields"
  | "invalid_email"
  | "honeypot";

/**
 * Bounces and complaints that could not be attributed to a workspace.
 *
 * WHY: app/api/webhooks/ses drops feedback it cannot map to a
 * `campaign_recipients` row, and dropping is the CORRECT behaviour — the
 * alternative is suppressing globally, which would let one tenant's bounce
 * silence an address for every other tenant. But the drop only reached
 * `console.warn`, and nobody reads the platform logs on a normal day. So a
 * systematic attribution failure — a deploy that stops recording message ids,
 * a configuration set wired to the wrong topic — looks exactly like clean
 * sending. That is the sentence from the task this table exists to answer:
 * the RATE of drops has to be visible.
 *
 * NO workspace_id, and that is the point rather than an omission. These are
 * the events for which no workspace could be determined; a column here would
 * invite somebody to guess one, and a guessed attribution is how a bounce ends
 * up suppressing the wrong tenant's subscriber.
 *
 * AGGREGATED, one row per (reason, event_type), same shape as
 * ingestion_failures above. Here the growth bound is stronger still: both
 * columns come from closed sets, so the table has a fixed maximum size of a
 * handful of rows no matter how much feedback arrives.
 *
 * `last_message_id` is the one unaggregated field. It is kept because "0.4% of
 * bounces are unattributable" is a number you cannot act on, whereas one real
 * SES message id can be traced through CloudWatch to the send that produced
 * it. One per row, overwritten, so it does not affect the size bound.
 */
export const feedbackDrops = pgTable(
  "feedback_drops",
  {
    id: serial("id").primaryKey(),
    /** no_message_id | unmapped_message_id */
    reason: text("reason").$type<FeedbackDropReason>().notNull(),
    /** SES's notificationType, e.g. "Bounce" or "Complaint". */
    eventType: text("event_type").notNull(),
    /** Newest SES message id seen for this pairing, for tracing one example. */
    lastMessageId: text("last_message_id"),
    count: integer("count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("feedback_drops_reason_event_idx").on(t.reason, t.eventType),
    index("feedback_drops_last_seen_idx").on(t.lastSeenAt),
  ],
);

/**
 * 'no_message_id' — SES sent feedback with no message id at all, so there is
 * nothing to match on. 'unmapped_message_id' — there was an id and it matched
 * no recipient row, which is legitimate for transactional ticket mail sharing
 * the configuration set, and a red flag in volume for a campaign.
 */
export type FeedbackDropReason = "no_message_id" | "unmapped_message_id";

/**
 * What operators DID, as distinct from where they went.
 *
 * `impersonation_sessions` records an operator entering a client's workspace.
 * It records nothing about the four actions that change the platform itself:
 * creating a workspace, DELETING one, and granting or revoking super-admin.
 * Until this table existed an operator could delete a client — cascading away
 * every ticket, message and subscriber they had — and nothing anywhere said
 * who, when, or that it had happened at all.
 *
 * ── NO FOREIGN KEY TO workspaces, AND THAT IS THE WHOLE POINT ──
 * `targetId` is a plain integer. A references() with the cascade this schema
 * uses elsewhere would mean deleting a workspace also deleted the record OF
 * that deletion — an audit log that erases exactly the entry somebody would
 * come looking for. `targetLabel` is a SNAPSHOT of the name at the time, for
 * the same reason: after the delete there is no row left to join to.
 *
 * ── A ROW MEANS "ATTEMPTED AND AUTHORISED", NOT "COMPLETED" ──
 * The write happens BEFORE the mutation and is fail-closed: if the log cannot
 * be written, the action does not proceed. That asymmetry is deliberate. A
 * recorded action that then failed is discoverable and confusing for five
 * minutes; an unrecorded deletion is undiscoverable forever. Recording after
 * the fact would lose precisely the case that matters most — the one where
 * something went wrong midway.
 */
export const adminActions = pgTable(
  "admin_actions",
  {
    id: serial("id").primaryKey(),
    /** The operator. Nullable so revoking an admin cannot erase their history. */
    actorAdminId: integer("actor_admin_id"),
    /** Snapshot of who they were, kept readable if the admin row goes. */
    actorEmail: text("actor_email").notNull(),
    action: text("action").$type<AdminActionKind>().notNull(),
    /** Id of the workspace or admin acted on. Not a foreign key — see above. */
    targetId: integer("target_id"),
    /** Name or email of the target AS IT WAS. Never resolved at read time. */
    targetLabel: text("target_label"),
    /** Free-text context, e.g. the typed confirmation. Optional. */
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /*
     * Chained, exactly like impersonation_sessions — see lib/hash-chain.ts.
     *
     * This log records an operator DELETING a client workspace, which is more
     * destructive than any impersonation. Leaving it unchained while the
     * viewing log was chained meant the more serious of the two records was
     * the easier one to erase quietly.
     *
     * Every column above is covered: nothing here is written after the insert,
     * so unlike impersonation_sessions there is no mutable tail the chain has
     * to leave out.
     */
    chainPrevHash: text("chain_prev_hash"),
    chainHash: text("chain_hash"),
  },
  (t) => [
    index("admin_actions_created_idx").on(t.createdAt),
    /*
     * The uniques are what make this a chain rather than a tree, enforced by
     * Postgres rather than by the writer remembering. Two operators acting at
     * the same moment can read the same head; without the unique on
     * chain_prev_hash both would commit and the chain would FORK, reporting a
     * break nobody caused. With it the second fails, retries against the new
     * head, and lands later in both id and chain order.
     */
    uniqueIndex("admin_actions_chain_prev_idx").on(t.chainPrevHash),
    uniqueIndex("admin_actions_chain_hash_idx").on(t.chainHash),
  ],
);

/**
 * The four platform-level actions. Deliberately a closed set: an open one
 * would let a caller invent a verb, and a log whose vocabulary drifts is one
 * nobody can query.
 */
export type AdminActionKind =
  | "workspace_created"
  | "workspace_deleted"
  | "admin_granted"
  | "admin_revoked"
  /*
   * An operator downloaded a client's ENTIRE dataset while inside their
   * workspace: every ticket, every message, every contact, as JSON.
   *
   * It is here rather than in impersonation_reads because it is not a record
   * being opened, it is all of them leaving at once — and because that table
   * is keyed on a ticket id, which an export does not have. Recording it as
   * fifty "conversation opened" rows would be both misleading about what
   * happened and unbounded in size.
   *
   * A CLIENT exporting their own data is not this. That is them exercising
   * portability and is not logged, the same way their own staff reading their
   * own inbox is not. This fires only during an impersonation.
   */
  | "workspace_exported";

/**
 * WHICH client records an operator actually opened, during an impersonation.
 *
 * ── THE DIFFERENCE THIS MAKES ──
 * impersonation_sessions answers "somebody from Postbox was in your workspace
 * for forty minutes". A client asking who read their customers' messages is
 * not asking that. They are asking whether anyone opened Jane Doe's complaint,
 * and that is the question Article 30 and any breach-scoping exercise actually
 * turn on. PIVOT 33 lists it first among the things still unlogged.
 *
 * ── OPERATOR ACCESS ONLY, AND THAT IS THE DECISION MADE HERE ──
 * This records reads by a POSTBOX OPERATOR inside a client's workspace. It does
 * NOT record a client's own staff reading their own tickets.
 *
 * Those are different questions with different answers. Operator access is
 * rare, externally accountable — we are the processor, they are the controller
 * — and bounded by how often anyone impersonates, so recording all of it costs
 * almost nothing. Logging every agent opening every ticket in their own inbox
 * is a different proposition: high volume, and surveillance of a client's own
 * employees that no one has asked for. That half stays unbuilt and undecided.
 *
 * ── IDS, NOT CONTENT ──
 * `ticket_id` and nothing else. No subject, no customer name, no preview. An
 * access log that copies the records it describes has duplicated the personal
 * data into a second table, which is the opposite of what it is for.
 *
 * AGGREGATED per (session, ticket): opening the same thread eleven times while
 * working is one row with a count, not eleven rows. Bounds the table by
 * distinct records touched rather than by clicking.
 */
export const impersonationReads = pgTable(
  "impersonation_reads",
  {
    id: serial("id").primaryKey(),
    /**
     * The visit this read belongs to. Cascades: a session row and its reads are
     * one record of one visit, and deleting the session is itself detectable
     * because impersonation_sessions is hash-chained.
     */
    sessionId: integer("session_id")
      .notNull()
      .references(() => impersonationSessions.id, { onDelete: "cascade" }),
    /**
     * Plain integer, deliberately not a foreign key to `tickets`. The evidence
     * "operator X opened ticket 4821 on this date" stays true and stays useful
     * after the ticket is deleted, and a cascade there would erase the record
     * of access to exactly the material somebody is asking about.
     */
    ticketId: integer("ticket_id").notNull(),
    count: integer("count").notNull().default(1),
    firstAt: timestamp("first_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("impersonation_reads_session_ticket_idx").on(
      t.sessionId,
      t.ticketId,
    ),
    /*
      No separate index on session_id. The unique index above already leads
      with it, so "every read in this session" — the only lookup this table
      has — uses that one. A second index would be maintained on every write
      and read by nothing.
    */
  ],
);

/**
 * Cross-invocation rate limiting.
 *
 * lib/rate-limit.ts is an in-memory Map, which is correct within ONE serverless
 * instance and therefore decorative on Vercel: concurrency spreads requests
 * across instances and every public limit is bypassed by simply making
 * requests in parallel. That matters most on /api/subscribe/[key], where each
 * accepted request sends an email TO A THIRD PARTY from our domain — an
 * unthrottled signup form is a mail-bombing tool charged to our sending
 * reputation.
 *
 * Fixed window, one row per bucket, incremented by a single atomic upsert. Not
 * a sliding window: that needs either a row per request (a growth primitive on
 * a public endpoint) or a sorted set this database does not have. A fixed
 * window lets a caller burst across a boundary, which is an acceptable price
 * for a safety valve.
 *
 * Rows are pruned by the daily health sweep — without that this grows one row
 * per distinct IP, forever.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    /** e.g. "subscribe:ip:1.2.3.4". Opaque to this table. */
    bucket: text("bucket").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true })
      .notNull()
      .defaultNow(),
    count: integer("count").notNull().default(1),
  },
  (t) => [index("rate_limits_window_idx").on(t.windowStart)],
);

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
export type AutoReplyQueueRow = typeof autoReplyQueue.$inferSelect;
export type Subscriber = typeof subscribers.$inferSelect;
export type List = typeof lists.$inferSelect;
export type ListSubscriber = typeof listSubscribers.$inferSelect;
export type Suppression = typeof suppressions.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type SendingDomain = typeof sendingDomains.$inferSelect;
export type IngestionFailure = typeof ingestionFailures.$inferSelect;
export type RateLimitRow = typeof rateLimits.$inferSelect;
