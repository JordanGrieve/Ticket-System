/**
 * Server-side ticket helpers.
 *
 * This module imports `lib/config`, which is `server-only`, so importing it
 * from a client component is now a build error. That is deliberate: it used to
 * be a silent bundle leak instead (see the header of `lib/ticket-format.ts`).
 *
 * The purely presentational helpers — initials, relative time, ticket-ref
 * formatting, preview text — live in `lib/ticket-format.ts` so client
 * components can have them without dragging config along. They are re-exported
 * below so server callers keep their existing `@/lib/tickets` import.
 */
import { INBOUND_DOMAIN } from "./config";
import { formatTicketRef } from "./ticket-format";
import type { TicketSource } from "@/db/schema";

export {
  formatTicketRef,
  initials,
  relativeTime,
  previewText,
} from "./ticket-format";

/**
 * Per-ticket reply address. Customer replies to this thread back into the
 * same ticket instead of opening a new one. The token is a per-ticket
 * secret: ids are sequential, so without it anyone could email messages
 * into other tenants' tickets.
 *   ticket+TKT-4821-9f3a2c1d@yourapp.com
 */
export function buildReplyTo(id: number, token: string | null): string {
  const suffix = token ? `-${token}` : "";
  return `ticket+${formatTicketRef(id)}${suffix}@${INBOUND_DOMAIN}`;
}

/**
 * Pull the ticket id + token out of an inbound "to" address such as
 * "ticket+TKT-4821-9f3a2c1d@yourapp.com". Returns null when it isn't a
 * per-ticket reply address. Token is null for legacy tokenless addresses
 * (which the inbound handler rejects against tokened tickets).
 */
export function parseTicketRefFromAddress(
  address: string,
): { id: number; token: string | null } | null {
  const match = address.match(/ticket\+TKT-(\d+)(?:-([a-z0-9]+))?@/i);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isInteger(id)) return null;
  return { id, token: match[2]?.toLowerCase() ?? null };
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

  const kept = lines.slice(0, cut);

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
