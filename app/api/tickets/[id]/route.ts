import { CORS_HEADERS, json, isValidEmail } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { previewText } from "@/lib/tickets";
import {
  getWorkspaceByApiKey,
  upsertContact,
  createTicket,
} from "@/lib/data";
import { notifyWorkspace } from "@/lib/notify";

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

  // Rate-limit per workspace so one client can't affect others.
  const limit = rateLimit(`ingest:${workspace.id}`);
  if (!limit.ok) {
    return json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: { ...CORS_HEADERS, "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  // Accept JSON (Mode B fetch) or form-encoded (Mode A native form).
  // Public, attacker-reachable input — cap every field's length.
  const fields = await readFields(req);
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
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
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
