import type { LabelColor, TicketSource, TicketStatus } from "@/db/schema";

/** One coloured label, as the chips render it. `color` is a token key. */
export type LabelChipDTO = {
  id: number;
  name: string;
  color: LabelColor;
  /** A picked colour, or null to use the theme token in `color`. */
  colorHex: string | null;
};

/** One row in the message list. Every field here is backed by a real column. */
export type MailRow = {
  id: number;
  name: string;
  email: string;
  subject: string;
  /** First line of the newest message. Empty string when the ticket has none. */
  preview: string;
  /** Compact relative time, e.g. "12m", "3h", "2d". */
  time: string;
  /**
   * When a person here last replied, same compact form. Null when nobody has —
   * an automatic acknowledgement is not somebody replying, so it does not set
   * this. The Sent folder shows it in place of `time`, which tracks the
   * ticket's activity rather than ours.
   */
  sentTime: string | null;
  /** First line of that reply, so Sent previews what we wrote, not what they said. */
  sentPreview: string;
  source: TicketSource;
  status: TicketStatus;
  orderId: string | null;
  /**
   * The newest message on this ticket came from the customer — nobody has
   * answered them yet. A property of the ticket, shared by the whole team.
   * Distinct from `unread`: reading a thread does not answer it.
   */
  awaitingReply: boolean;
  /**
   * This agent has not seen the newest inbound message. Personal, and always
   * false for a viewer with no agent row in this workspace (a super-admin).
   */
  unread: boolean;
  /** Starred by this agent. Also personal; also false without an agent row. */
  starred: boolean;
  labels: LabelChipDTO[];
};

/** Folder counts shown in the nav. All are real COUNT(*) results. */
export type MailCountsDTO = {
  all: number;
  unread: number;
  awaiting: number;
  inbox: number;
  closed: number;
  starred: number;
  labeled: number;
  /** Tickets a person here has replied to at least once. */
  sent: number;
  /** Off the inbox, but neither resolved nor deleted. */
  archived: number;
  /**
   * Hidden until a future time.
   *
   * The one count that can change with nobody having done anything: the state
   * is `snoozed_until > now()`, so a ticket leaves this the moment its time
   * arrives. A cached render of the nav can therefore be stale in a way the
   * others cannot — which is fine, because the next request recomputes it.
   */
  snoozed: number;
  /** Deleted, still recoverable, not yet purged. Every other count excludes these. */
  trash: number;
};

/** A label plus how many of this workspace's tickets carry it. */
export type LabelWithCountDTO = LabelChipDTO & { ticketCount: number };

/** What the contact rail can honestly show about a person. */
export type ContactCard = {
  name: string;
  email: string;
  /** ISO date of the contacts row, or null when we never recorded one. */
  firstSeenIso: string | null;
  ticketCount: number;
};
