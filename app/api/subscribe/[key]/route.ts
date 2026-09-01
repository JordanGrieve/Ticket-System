import { CORS_HEADERS, json, clientIp } from "@/lib/http";
import { rateLimitDurable } from "@/lib/rate-limit-store";
import { getWorkspaceByApiKey } from "@/lib/data";
import { recordIngestionFailure } from "@/lib/ingestion-log";
import { APP_URL } from "@/lib/config";
import {
  consentSourceFrom,
  isHoneypotTripped,
  parseSignupInput,
} from "@/lib/subscribe";
import {
  resolveSigningSecret,
  sendConfirmationEmail,
} from "@/lib/subscribe-store";

/**
 * POST /api/subscribe/:apiKey — PUBLIC newsletter signup.
 *
 * The twin of /api/tickets/:apiKey and deliberately shaped like it: same key
 * in the same position, same CORS, same JSON-or-form body. A client who has
 * already pasted the contact snippet can paste this one without learning
 * anything new.
 *
 * ── NOTHING IS WRITTEN HERE ──
 * This endpoint sends an email and returns. The subscriber row is created by
 * app/api/subscribe-confirm, when the link in that email is pressed. See the
 * header of lib/subscribe.ts for why the pending state lives in a signed token
 * rather than a row: an unauthenticated endpoint that writes a row per POST is
 * a free database-growth primitive for anyone who reads the client's page
 * source — and the key is *meant* to be in that page source.
 *
 * ── NO ORACLE ──
 * Every accepted submission returns the same body. Not whether the address is
 * already subscribed, not whether it is suppressed, not whether the send
 * failed. Varying the response would turn a public form into a membership
 * check against any tenant's list — "is bob@rival.co on Acme's list", asked by
 * a stranger with curl. The submitter is told to check their inbox, which is
 * true in every one of those cases.
 */

// ── CORS preflight ───────────────────────────────────────────────
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  req: Request,
  // Typed inline rather than with RouteContext<>: that helper resolves against
  // generated route types, which do not exist for a route until the next
  // typegen run, so a brand-new file cannot typecheck against it.
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;

  const workspace = await getWorkspaceByApiKey(key);
  if (!workspace) {
    await recordIngestionFailure({ reason: "invalid_key", key });
    return json(
      { ok: false, error: "Invalid API key." },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  // Two buckets, different jobs. The workspace bucket stops one client's form
  // — or one bot hammering it — from consuming the shared send budget and
  // degrading other tenants. The IP bucket is far tighter, because the unit of
  // abuse here is AN EMAIL TO A THIRD PARTY: an unthrottled signup form is a
  // mail-bombing tool pointed at whatever address the attacker types, sent
  // from our domain and charged to our sending reputation.
  const ip = clientIp(req);
  const buckets: Array<[string, { max: number; windowMs: number }]> = [
    [`subscribe:ws:${workspace.id}`, { max: 60, windowMs: 60_000 }],
  ];
  if (ip) buckets.push([`subscribe:ip:${ip}`, { max: 5, windowMs: 60_000 }]);

  for (const [bucket, opts] of buckets) {
    const limit = await rateLimitDurable(bucket, opts);
    if (!limit.ok) {
      // Same reasoning as the twin in /api/tickets/[id]: a 429 here may be
      // refusing somebody who genuinely wanted to subscribe, and a signup lost
      // this way leaves no trace on either side.
      await recordIngestionFailure({
        reason: "rate_limited",
        key,
        workspaceId: workspace.id,
      });
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

  const fields = await readFields(req);

  // Honeypot: answer exactly as if it had worked. A bot told it failed retries
  // with the field cleared; a bot told it succeeded goes away. Checked before
  // validation so a tripped submission never reaches the mailer.
  if (isHoneypotTripped(fields)) {
    await recordIngestionFailure({
      reason: "honeypot",
      key,
      workspaceId: workspace.id,
    });
    return accepted(req, workspace.name);
  }

  const parsed = parseSignupInput(fields);
  if (!parsed.ok) {
    return badRequest(req, parsed.error);
  }

  // Refused, not degraded. Without a signing key there is no way to mint a
  // confirmation link that cannot be forged, and both alternatives are worse
  // than an honest failure: subscribing without confirmation manufactures
  // consent records that are evidence of nothing, and accepting silently while
  // never sending is a form that lies to every person who uses it.
  const secret = resolveSigningSecret();
  if (!secret) {
    console.error(
      "[subscribe] SUBSCRIBE_TOKEN_SECRET is not set; refusing signup for workspace",
      workspace.id,
    );
    return json(
      { ok: false, error: "Signups are not available right now." },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  // Evidence comes from the browser's own headers, never from a body field.
  // See consentSourceFrom(): a `source` field in the POST is written by
  // whoever wrote the page, and on this endpoint that is not necessarily the
  // workspace owner.
  const consentSource = consentSourceFrom({
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
  });

  // Best effort, and the response below does not vary on it. See "no oracle".
  await sendConfirmationEmail({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceReplyTo: workspace.sendingEmail ?? workspace.inboundEmail,
    email: parsed.value.email,
    name: parsed.value.name,
    consentSource,
    secret,
  });

  return accepted(req, workspace.name);
}

// ── helpers ──────────────────────────────────────────────────────

const ACCEPTED_MESSAGE =
  "Thanks — please check your inbox and press the confirmation link.";

/**
 * The one success response. A native form post is sent to a hosted page; a
 * fetch gets JSON. Both say the same thing, and both say it regardless of what
 * actually happened behind them.
 */
function accepted(req: Request, workspaceName: string): Response {
  if (wantsHtml(req)) {
    return new Response(null, {
      // 303 so the browser follows with GET. A 302 would let a reload of the
      // destination re-submit the form.
      status: 303,
      headers: {
        ...CORS_HEADERS,
        Location: `${APP_URL.replace(/\/$/, "")}/s/check`,
      },
    });
  }
  return json(
    { ok: true, message: ACCEPTED_MESSAGE, workspace: workspaceName },
    // 202, not 200: nothing has happened yet but a message has been sent. The
    // subscriber does not exist until the link is pressed.
    { status: 202, headers: CORS_HEADERS },
  );
}

function isJsonRequest(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").includes("application/json");
}

function wantsHtml(req: Request): boolean {
  return (
    !isJsonRequest(req) &&
    (req.headers.get("accept") ?? "").includes("text/html")
  );
}

/** JSON or form-encoded, and never a 500 on a body we cannot parse. */
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
  // formData() throws on a body it cannot parse, and the key that reaches this
  // endpoint is published in the client's own page source. Unguarded, that
  // makes view-source plus a malformed POST into a public 500. Same guard and
  // same reason as app/api/tickets/[id]/route.ts.
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

function badRequest(req: Request, error: string): Response {
  if (wantsHtml(req)) {
    return new Response(null, {
      status: 303,
      headers: {
        ...CORS_HEADERS,
        // A FLAG, not the message. Redirecting with `?e=<error text>` would
        // let anyone put arbitrary words on a postbox.help page by handing out
        // a crafted link — a phishing surface on our own domain, paid for by a
        // marginally better error message. The page carries its own wording;
        // the specific reason still reaches fetch callers in the JSON below.
        Location: `${APP_URL.replace(/\/$/, "")}/s/check?e=1`,
      },
    });
  }
  return json({ ok: false, error }, { status: 400, headers: CORS_HEADERS });
}
