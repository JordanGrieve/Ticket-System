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

/**
 * Strip the quoted history from an email reply so the ticket shows only the
 * newly written words. Conservative: cuts at common reply markers ("On …
 * wrote:", "--- Original Message ---", Outlook's underscore rule), drops
 * trailing "&gt;"-quoted blocks and mobile signatures. If stripping would
 * leave nothing, the original text is returned untouched.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);

  const markers = [
    /^On .{3,120} wrote:\s*$/,
    /^-{2,}\s*Original Message\s*-{2,}$/i,
    /^_{5,}\s*$/,
    /^-{5,}\s*$/,
    /^From:\s.+@.+$/i,
  ];
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (markers.some((m) => m.test(t))) {
      cut = i;
      break;
    }
    // Gmail wraps long attributions: "On … <a@b.c>\nwrote:" — join up to two
    // continuation lines before testing.
    if (/^On\s/.test(t)) {
      const joined = [t, lines[i + 1]?.trim() ?? "", lines[i + 2]?.trim() ?? ""]
        .join(" ")
        .trim();
      if (/^On .{3,200} wrote:/.test(joined)) {
        cut = i;
        break;
      }
    }
  }

  let kept = lines.slice(0, cut);

  // Drop trailing quoted lines and blank lines left behind.
  while (kept.length > 0) {
    const last = kept[kept.length - 1].trim();
    if (last === "" || last.startsWith(">")) kept.pop();
    else break;
  }

  // Drop trailing mobile signatures ("Sent from my iPhone" etc.).
  while (kept.length > 0) {
    const last = kept[kept.length - 1].trim();
    if (/^Sent from (my )?.{2,40}$/i.test(last) || last === "") kept.pop();
    else break;
  }

  const result = kept.join("\n").trim();
  return result || text.trim();
}

/** A tidy first-line preview for the inbox list. */
export function previewText(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}
