import type {
  Ticket,
  TicketMessage,
  TicketSource,
  TicketStatus,
  MessageDirection,
} from "@/db/schema";
import { relativeTime, formatTicketRef } from "./tickets";

export type TicketDTO = {
  id: number;
  ref: string;
  source: TicketSource;
  orderId: string | null;
  customerName: string;
  customerEmail: string;
  subject: string;
  status: TicketStatus;
  timeShort: string;
};

export type MessageDTO = {
  id: number;
  direction: MessageDirection;
  body: string;
  time: string;
};

export function toTicketDTO(t: Ticket, now: Date = new Date()): TicketDTO {
  return {
    id: t.id,
    ref: formatTicketRef(t.id),
    source: t.source,
    orderId: t.orderId,
    customerName: t.customerName,
    customerEmail: t.customerEmail,
    subject: t.subject,
    status: t.status,
    timeShort: relativeTime(t.updatedAt, now),
  };
}

export function toMessageDTO(m: TicketMessage): MessageDTO {
  return {
    id: m.id,
    direction: m.direction,
    body: m.body,
    time: formatDateTime(m.sentAt),
  };
}

/** Human timestamp like "Today, 9:24 AM" / "Yesterday, 5:02 PM" / "3 Jul, 4:12 PM". */
export function formatDateTime(input: Date | string, now: Date = new Date()): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const time = d.toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86_400_000);

  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago, ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${date}, ${time}`;
}
