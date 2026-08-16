import type { LabelColor, TicketSource, TicketStatus } from "@/db/schema";

/** One coloured label, as the chips render it. `color` is a token key. */
export type LabelChipDTO = {
  id: number;
  name: string;
  color: LabelColor;
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
