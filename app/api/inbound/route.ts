import { createHmac, timingSafeEqual } from "crypto";
import { json } from "@/lib/http";
import {
  getWorkspaceByInboundEmail,
  getTicket,
  createTicket,
  addMessage,
  upsertContact,
  backfillOutboundMessageId,
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
  // Authenticate the caller. Two accepted proofs, in preference order:
  //  1. Resend's Svix signature (RESEND_WEBHOOK_SIGNING_SECRET) — cryptographic,
  //     immune to URL copy/paste accidents. Needs the RAW request body.
  //  2. Shared secret via ?secret= / x-webhook-secret (INBOUND_WEBHOOK_SECRET)
  //     — kept for manual testing. Placeholder value disables checks (dev).
  const raw = await req.text();

  const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  const sharedSecret = process.env.INBOUND_WEBHOOK_SECRET;
  const sharedEnabled = !!sharedSecret && sharedSecret !== "dev-secret-change-me";

  if (signingSecret || sharedEnabled) {
    const url = new URL(req.url);
    const provided =
      req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
    const sharedOk = sharedEnabled && provided === sharedSecret;
    const svixOk =
      !!signingSecret && verifySvixSignature(raw, req.headers, signingSecret);
    if (!sharedOk && !svixOk) {
      return json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resend wraps events as { type, data: {...} }; inbound test posts may be flat.
  const data = (payload.data as Record<string, unknown>) ?? payload;

  const sender = extractAddress(data.from);
  const subject = asString(data.subject) || "(no subject)";
  const body = extractBody(data);
  const recipients = normalizeRecipients(data.to);
  const messageId = extractMessageId(data);

  if (!sender.email) {
    return json({ error: "Missing sender" }, { status: 400 });
  }

  // 1) Reply to an existing thread?
  for (const addr of recipients) {
    const ticketId = parseTicketRefFromAddress(addr);
    if (ticketId != null) {
      const ticket = await lookupTicketAnyWorkspace(ticketId);
      if (ticket) {
        // The customer's reply tells us the real Message-ID SES assigned to
        // OUR last reply (their In-Reply-To). Learn it so future replies can
        // reference the full chain.
        const inReplyTo = extractHeaderValue(data, "in-reply-to");
        if (inReplyTo) {
          await backfillOutboundMessageId(ticket.id, normalizeMsgId(inReplyTo));
        }
        await addMessage({
          ticketId: ticket.id,
          direction: "inbound",
          body: body || "(empty message)",
          status: "open", // customer replied → needs attention again
          messageId,
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
        messageId,
      });
      return json({ ok: true, ticket: ticket.id, source }, { status: 201 });
    }
  }

  // Nothing matched — acknowledge so Resend doesn't retry endlessly.
  return json({ ok: true, ignored: true });
}

// ── auth helpers ─────────────────────────────────────────────────

/**
 * Verify a Svix webhook signature (what Resend signs deliveries with).
 * signedContent = "{svix-id}.{svix-timestamp}.{rawBody}", HMAC-SHA256 keyed
 * with the base64 part of the whsec_ signing secret, compared (timing-safe)
 * against each space-separated "v1,<base64>" entry in svix-signature.
 */
function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  signingSecret: string,
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject stale/future timestamps (replay protection, ±5 minutes).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  let key: Buffer;
  try {
    key = Buffer.from(
      signingSecret.startsWith("whsec_") ? signingSecret.slice(6) : signingSecret,
      "base64",
    );
  } catch {
    return false;
  }

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  for (const part of signatureHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
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

/**
 * Read a header from the webhook payload, tolerating the shapes providers
 * use: a headers list (array of {name,value}) or a plain record.
 */
function extractHeaderValue(
  data: Record<string, unknown>,
  name: string,
): string {
  if (Array.isArray(data.headers)) {
    for (const h of data.headers as Array<Record<string, unknown>>) {
      if (asString(h?.name).toLowerCase() === name) return asString(h?.value);
    }
  } else if (data.headers && typeof data.headers === "object") {
    const rec = data.headers as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (key.toLowerCase() === name) return asString(rec[key]);
    }
  }
  return "";
}

/** Ensure an id is wrapped in angle brackets, RFC-style. */
function normalizeMsgId(raw: string): string {
  const s = raw.trim();
  return s.startsWith("<") ? s : `<${s}>`;
}

/**
 * Pull the RFC Message-ID out of the webhook payload: a top-level
 * message_id/messageId field, or the headers. Null when absent.
 */
function extractMessageId(data: Record<string, unknown>): string | null {
  const raw =
    asString(data.message_id) ||
    asString(data.messageId) ||
    extractHeaderValue(data, "message-id");
  return raw.trim() ? normalizeMsgId(raw) : null;
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
