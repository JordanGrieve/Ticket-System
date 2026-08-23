import { CORS_HEADERS, json, isValidEmail, clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { isHoneypotTripped } from "@/lib/subscribe";
import { previewText } from "@/lib/tickets";
import {
  getWorkspaceByApiKey,
  upsertContact,
  createTicket,
} from "@/lib/data";
import { notifyWorkspace } from "@/lib/notify";
import { maybeSendAutoReply } from "@/lib/auto-reply-send";

/**
 * POST /api/tickets/:apiKey — PUBLIC contact-form ingestion. The dashboard
 * reads tickets through server components, so there is no JSON read API.
 */

// ── CORS preflight ───────────────────────────────────────────────
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── PUBLIC: contact-form ingestion ───────────────────────────────
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/tickets/[id]">,
) {
  const { id: apiKey } = await ctx.params;

  const workspace = await getWorkspaceByApiKey(apiKey);
  if (!workspace) {
    return json(
      { ok: false, error: "Invalid API key." },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  // Two buckets. The workspace one stops a flood against one client from
  // consuming shared capacity; the IP one bounds a single sender, because each
  // accepted POST here writes a row AND sends up to two emails (the workspace
  // notification and the customer auto-reply). Without it, a stranger who
  // view-sources the client's page — where this key is published by design —
  // has an unmetered write-and-mail primitive.
  //
  // Both are still only as strong as lib/rate-limit.ts, which is an in-memory
  // Map and therefore per-instance. On Vercel that means concurrency defeats
  // it. Tracked separately; this closes the single-sender case, not the
  // distributed one.
  const ip = clientIp(req);
  const buckets: Array<[string, { max: number; windowMs: number } | undefined]> = [
    [`ingest:${workspace.id}`, undefined],
  ];
  if (ip) buckets.push([`ingest:ip:${ip}`, { max: 10, windowMs: 60_000 }]);

  for (const [bucket, opts] of buckets) {
    const limit = opts ? rateLimit(bucket, opts) : rateLimit(bucket);
    if (!limit.ok) {
      return json(
        { ok: false, error: "Too many requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            "Retry-After": String(limit.retryAfterSeconds),
          },
        },
      );
    }
  }

  // Accept JSON (Mode B fetch) or form-encoded (Mode A native form).
  // Public, attacker-reachable input — cap every field's length.
  const fields = await readFields(req);

  // Honeypot, shared with the newsletter signup so both forms trap the same
  // field names and neither can drift. Answered as if it had worked: a bot
  // told it failed retries with the field cleared, one told it succeeded goes
  // away. Checked before validation so a tripped submission never reaches the
  // database or the mailer.
  //
  // ABSENT is fine and always will be — the documented JSON API does not
  // mention these fields, and the contact snippet that predates them omits
  // them. This only ever catches a filler that populated one.
  if (isHoneypotTripped(fields)) {
    return honeypotSuccess(req, workspace.name);
  }
  const name = (fields.name ?? "").trim().slice(0, 120);
  const email = (fields.email ?? "").trim();
  const message = (fields.message ?? "").trim().slice(0, 10_000);
  const subject = (fields.subject ?? "").trim().slice(0, 200);

  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!email) missing.push("email");
  if (!message) missing.push("message");
  if (missing.length > 0) {
    return badRequest(req, `Missing required field(s): ${missing.join(", ")}.`);
  }
  if (email.length > 254 || !isValidEmail(email)) {
    return badRequest(req, "Please provide a valid email address.");
  }

  await upsertContact(workspace.id, name, email);

  const ticket = await createTicket({
    workspaceId: workspace.id,
    source: "contact_form",
    customerName: name,
    customerEmail: email,
    subject: subject || previewText(message, 60),
    body: message,
  });

  await notifyWorkspace({ workspace, ticket, kind: "new", body: message });
  // Acknowledge the customer. Best-effort and self-guarding — see
  // lib/auto-reply.ts; a suppressed or failed auto-reply never fails the
  // submission.
  await maybeSendAutoReply({ workspace, ticket });

  // A native form submit (Mode A) navigates the browser here — show a tidy
  // confirmation page instead of raw JSON. Fetch/JSON callers get JSON.
  const wantsHtml =
    !isJsonRequest(req) && (req.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) {
    return htmlSuccess(workspace.name);
  }

  return json(
    { ok: true, ticket: { id: ticket.id, status: ticket.status } },
    { status: 201, headers: CORS_HEADERS },
  );
}

// ── helpers ──────────────────────────────────────────────────────

function isJsonRequest(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").includes("application/json");
}

async function readFields(req: Request): Promise<Record<string, string>> {
  if (isJsonRequest(req)) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if (v != null) out[k] = String(v);
      }
      return out;
    } catch {
      return {};
    }
  }
  // formData() THROWS on a body it cannot parse — text/plain, application/xml,
  // or no content-type at all — and this is a public endpoint whose API key is
  // embedded in the client's own page source. Unguarded, anyone who views
  // source could turn a malformed POST into a 500. Fall through to the same
  // empty result the JSON branch gives, and let the caller's validation
  // produce the honest 400.
  try {
    const form = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The reply to a tripped honeypot: byte-identical in shape to a real success,
 * and a lie. Nothing was written and nobody was emailed.
 *
 * The ticket id is the giveaway to guard against — a real success returns one,
 * so this returns one too. `0` is used rather than a plausible number because
 * no ticket has id 0, so anything that later trusts this value fails loudly
 * instead of pointing at somebody else's ticket.
 */
function honeypotSuccess(req: Request, workspaceName: string): Response {
  if (!isJsonRequest(req) && (req.headers.get("accept") ?? "").includes("text/html")) {
    return htmlSuccess(workspaceName);
  }
  return json(
    { ok: true, ticket: { id: 0, status: "open" } },
    { status: 201, headers: CORS_HEADERS },
  );
}

function badRequest(req: Request, error: string): Response {
  const wantsHtml =
    !isJsonRequest(req) && (req.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) {
    return new Response(errorPage(error), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
    });
  }
  return json({ ok: false, error }, { status: 400, headers: CORS_HEADERS });
}

function htmlSuccess(workspaceName: string): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Message sent</title>
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#faf8f4;color:#26221d;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border:1px solid #e7e1d7;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 30px 60px -30px rgba(60,50,35,.28)}
.dot{width:56px;height:56px;border-radius:50%;background:#f9e7de;color:#d6552f;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 18px}
h1{font-size:20px;margin:0 0 8px}p{color:#7a7264;line-height:1.6;margin:0}</style></head>
<body><div class="card"><div class="dot">✓</div><h1>Thanks — we got your message</h1>
<p>${escapeHtml(workspaceName)} has received your enquiry and will reply by email soon.</p></div></body></html>`;
  return new Response(body, {
    status: 201,
    headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
  });
}

function errorPage(error: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Couldn't send</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#faf8f4;color:#26221d;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border:1px solid #e7e1d7;border-radius:16px;padding:40px;max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#7a7264;margin:0}</style></head>
<body><div class="card"><h1>We couldn't send that</h1><p>${escapeHtml(error)}</p></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
