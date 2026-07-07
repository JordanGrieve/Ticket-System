import { INBOUND_DOMAIN } from "./config";
import type { TicketSource } from "@/db/schema";

/** Human-friendly ticket reference, e.g. TKT-4821. */
export function formatTicketRef(id: number): string {
  return `TKT-${id}`;
}

/**
 * Per-ticket reply address. Customer replies to this thread back into the
 * same ticket instead of opening a new one.
 *   ticket+TKT-4821@inbound.yourapp.com
 */
export function buildReplyTo(id: number): string {
  return `ticket+${formatTicketRef(id)}@${INBOUND_DOMAIN}`;
}

/**
 * Pull a ticket id out of an inbound "to" address such as
 * "ticket+TKT-4821@inbound.yourapp.com". Returns null when it isn't a
 * per-ticket reply address.
 */
export function parseTicketRefFromAddress(address: string): number | null {
  const match = address.match(/ticket\+TKT-(\d+)@/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) ? id : null;
}

/**
 * Order-ID detection. Runs over subject + body of inbound mail.
 * Matches "ORD-1234" or a "#123" style reference (3+ digits).
 */
export function detectOrderId(text: string): string | null {
  const ordMatch = text.match(/\bORD-\d+\b/i);
  if (ordMatch) return ordMatch[0].toUpperCase();
  const hashMatch = text.match(/#\d{3,}\b/);
  if (hashMatch) return hashMatch[0];
  return null;
}

/** Given an inbound email, decide its source + optional order id. */
export function classifyInbound(subject: string, body: string): {
  source: Extract<TicketSource, "email" | "order">;
  orderId: string | null;
} {
  const orderId = detectOrderId(`${subject}\n${body}`);
  return orderId ? { source: "order", orderId } : { source: "email", orderId: null };
}

/** Two-letter initials from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Compact relative time like "12m", "3h", "2d", "5w". */
export function relativeTime(from: Date | string, now: Date = new Date()): string {
  const then = typeof from === "string" ? new Date(from) : from;
  const secs = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

/** A tidy first-line preview for the inbox list. */
export function previewText(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}
