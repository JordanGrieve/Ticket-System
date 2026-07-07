import { json } from "@/lib/http";
import {
  getWorkspaceByInboundEmail,
  getTicket,
  createTicket,
  addMessage,
  upsertContact,
} from "@/lib/data";
import {
  classifyInbound,
  parseTicketRefFromAddress,
  previewText,
} from "@/lib/tickets";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/inbound — Resend inbound-email webhook.
 *
 * Two cases, decided by the recipient address:
 *   • ticket+TKT-<id>@inbound…  → append an inbound message to that thread.
 *   • <workspace>@inbound…      → open a NEW ticket (source email/order).
 *
 * Order detection: subject/body is scanned for ORD-\d+ or #\d{3,}; a match
 * makes the ticket source="order" (higher priority) with the order id stored.
 */
export async function POST(req: Request) {
  // Verify the shared secret when configured (skip in local dev with the
  // placeholder). In production, prefer verifying Resend's Svix signature.
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (secret && secret !== "dev-secret-change-me") {
    const url = new URL(req.url);
    const provided =
      req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
    if (provided !== secret) {
      return json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resend wraps events as { type, data: {...} }; inbound test posts may be flat.
  const data = (payload.data as Record<string, unknown>) ?? payload;

  const sender = extractAddress(data.from);
  const subject = asString(data.subject) || "(no subject)";
  const body = extractBody(data);
  const recipients = normalizeRecipients(data.to);

  if (!sender.email) {
    return json({ error: "Missing sender" }, { status: 400 });
  }

  // 1) Reply to an existing thread?
  for (const addr of recipients) {
    const ticketId = parseTicketRefFromAddress(addr);
    if (ticketId != null) {
      const ticket = await lookupTicketAnyWorkspace(ticketId);
      if (ticket) {
        await addMessage({
          ticketId: ticket.id,
          direction: "inbound",
          body: body || "(empty message)",
          status: "open", // customer replied → needs attention again
        });
        return json({ ok: true, threadedInto: ticket.id });
      }
    }
  }

  // 2) New ticket to a workspace inbound address.
  for (const addr of recipients) {
    const workspace = await getWorkspaceByInboundEmail(addr);
    if (workspace) {
      const { source, orderId } = classifyInbound(subject, body);
      await upsertContact(
        workspace.id,
        sender.name || sender.email,
        sender.email,
      );
      const ticket = await createTicket({
        workspaceId: workspace.id,
        source,
        orderId,
        customerName: sender.name || sender.email,
        customerEmail: sender.email,
        subject: subject || previewText(body, 60),
        body: body || "(empty message)",
      });
      return json({ ok: true, ticket: ticket.id, source }, { status: 201 });
    }
  }

  // Nothing matched — acknowledge so Resend doesn't retry endlessly.
  return json({ ok: true, ignored: true });
}

// ── parsing helpers ──────────────────────────────────────────────

async function lookupTicketAnyWorkspace(id: number) {
  // Reply addresses embed the ticket id directly, so the workspace is implied
  // by the ticket. Still verify the ticket exists before appending.
  const rows = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  const t = rows[0];
  if (!t) return null;
  // Reuse the scoped getter to keep a single source of truth.
  return getTicket(t.workspaceId, id);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse "Name <a@b.com>" | "a@b.com" | { email/address, name }. */
function extractAddress(v: unknown): { name: string; email: string } {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const email = asString(o.email || o.address).toLowerCase();
    return { name: asString(o.name), email };
  }
  const s = asString(v);
  const angled = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (angled) {
    return { name: angled[1].trim(), email: angled[2].trim().toLowerCase() };
  }
  return { name: "", email: s.trim().toLowerCase() };
}

/** `to` may be a string, comma list, array of strings, or array of objects. */
function normalizeRecipients(v: unknown): string[] {
  const out: string[] = [];
  const push = (x: unknown) => {
    const { email } = extractAddress(x);
    if (email) out.push(email);
  };
  if (Array.isArray(v)) {
    for (const item of v) push(item);
  } else if (typeof v === "string") {
    for (const part of v.split(",")) push(part);
  } else if (v) {
    push(v);
  }
  return out;
}

/** Prefer plain text; fall back to a rough strip of HTML. */
function extractBody(data: Record<string, unknown>): string {
  const text = asString(data.text);
  if (text.trim()) return text.trim();
  const html = asString(data.html);
  if (html.trim()) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}
