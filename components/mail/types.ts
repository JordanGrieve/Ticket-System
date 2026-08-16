import type { TicketSource, TicketStatus } from "@/db/schema";

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
   * The newest message on this ticket came from the customer. Stands in for
   * the design's "unread" dot, which has no column behind it.
   */
  awaitingReply: boolean;
};

/** Folder counts shown in the nav. All four are real COUNT(*) results. */
export type MailCountsDTO = {
  all: number;
  awaiting: number;
  inbox: number;
  closed: number;
};

/** What the contact rail can honestly show about a person. */
export type ContactCard = {
  name: string;
  email: string;
  /** ISO date of the contacts row, or null when we never recorded one. */
  firstSeenIso: string | null;
  ticketCount: number;
};
