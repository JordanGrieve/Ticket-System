import { CORS_HEADERS, json, clientIp } from "@/lib/http";
import { rateLimitDurable } from "@/lib/rate-limit-store";
import { getWorkspaceByApiKey } from "@/lib/data";
import { recordIngestionFailure } from "@/lib/ingestion-log";
import { readSignupSubmission } from "@/lib/submission-fields";
import { APP_URL } from "@/lib/config";
import {
  consentSourceFrom,
  isHoneypotTripped,
  parseSignupInput,
} from "@/lib/subscribe";
import {
  resolveSigningSecret,
  sendConfirmationEmail,
  confirmSubscription,
} from "@/lib/subscribe-store";
import { sendWelcomeEmail } from "@/lib/welcome-store";

/**
 * POST /api/subscribe/:apiKey — PUBLIC newsletter signup.
 *
 * The twin of /api/tickets/:apiKey and deliberately shaped like it: same key
 * in the same position, same CORS, same JSON-or-form body. A client who has
 * already pasted the contact snippet can paste this one without learning
 * anything new.
 *
 * ── TWO PATHS, CHOSEN PER WORKSPACE ──
 * `workspaces.require_signup_confirmation` decides, and it is false by default
 * (see db/schema.ts for why the default is single opt-in and why the switch is
 * a column rather than a constant).
 *
 * SINGLE (default): the subscriber row is written here and the welcome email
 * goes out immediately. Costs: an unauthenticated endpoint that writes a row
 * per POST is a database-growth primitive for anyone who reads the client's
 * page source — and the key is *meant* to be in that page source. The two rate
 * limits below are what bound it, and they are the reason this is affordable:
 * 60/min per workspace and 5/min per IP.
 *
 * DOUBLE: nothing is written. This endpoint sends one email and returns; the
 * row is created by app/api/subscribe-confirm when the link is pressed. See
 * lib/subscribe.ts for why the pending state lives in a signed token rather
 * than a row.
 *
 * ── NO ORACLE ──
 * Within a path, every accepted submission returns the same body. Not whether
 * the address is already subscribed, not whether it is suppressed, not whether
 * the send failed. Varying the response would turn a public form into a
 * membership check against any tenant's list — "is bob@rival.co on Acme's
 * list", asked by a stranger with curl.
 *
 * The two paths DO answer differently from each other, and that leaks nothing:
 * which one a workspace is on is a property of the workspace, identical for
 * every address submitted to it, so it cannot distinguish one address from
 * another. It is also visible from the client's own form copy either way.
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

  // Same liberal read as the contact endpoint: a Shopify signup posts
  // contact[email], not email. See lib/submission-fields.ts.
  const parsed = parseSignupInput(readSignupSubmission(fields));
  if (!parsed.ok) {
    return badRequest(req, parsed.error);
  }

  // Evidence comes from the browser's own headers, never from a body field.
  // See consentSourceFrom(): a `source` field in the POST is written by
  // whoever wrote the page, and on this endpoint that is not necessarily the
  // workspace owner.
  const consentSource = consentSourceFrom({
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
  });

  /*
    ── SINGLE OPT-IN ──

    The default, per workspaces.require_signup_confirmation. The address goes
    on the list now and the welcome email goes out immediately, carrying the
    one-click unsubscribe every campaign carries.

    That unsubscribe is the safety valve, and it is the reason this is
    defensible on a shared sending domain: the form is public, so anybody can
    type somebody else's address into it, and the person who receives a welcome
    they did not ask for gets a way out that is not the spam button. The
    complaint is what damages every other client's delivery; the unsubscribe
    costs nothing.

    Suppressions still win — the check is inside confirmSubscription's
    statement, so an address that reported this sender for spam is not put back
    on by a stranger filling in a form.
  */
  if (!workspace.requireSignupConfirmation) {
    const outcome = await confirmSubscription({
      workspaceId: workspace.id,
      email: parsed.value.email,
      name: parsed.value.name,
      consentSource,
      // The submission's IP, because under single opt-in the submission is the
      // act being consented to. Same reasoning as the click's IP under double.
      consentIp: clientIp(req),
      method: "single",
    });

    /*
      Awaited, not fire-and-forget: Vercel freezes the function when the
      response returns, so a floating promise dies at an unpredictable point.
      Same rule, and the same reasons, as the confirm route.

      Gated on consentRecorded rather than subscribed, so re-submitting a form
      with an address already on the list does not mail them a second welcome.
    */
    if (outcome.consentRecorded && !outcome.suppressed) {
      const welcome = await sendWelcomeEmail({
        workspaceId: workspace.id,
        email: parsed.value.email,
        name: parsed.value.name,
      });
      if (
        !welcome.sent &&
        welcome.reason !== "disabled" &&
        welcome.reason !== "not_configured"
      ) {
        console.warn(
          "[subscribe] welcome not sent for workspace=%d reason=%s",
          workspace.id,
          welcome.reason,
        );
      }
    }

    return subscribed(req, workspace.name);
  }

  // Refused, not degraded. Without a signing key there is no way to mint a
  // confirmation link that cannot be forged, and both alternatives are worse
  // than an honest failure: subscribing without confirmation would be silently
  // overriding the setting this workspace is on, and accepting while never
  // sending is a form that lies to every person who uses it.
  //
  // Reached only on the double opt-in path now: single opt-in mints no token,
  // so a missing secret is no longer a reason to refuse a signup it does not
  // need.
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

const SUBSCRIBED_MESSAGE = "You're subscribed — thanks for joining.";

/**
 * The single opt-in success response. Separate from `accepted` below because
 * it is a different claim: there, a message has been sent and nothing has
 * happened yet; here the address is on the list. A form that said "check your
 * inbox" after single opt-in would send people looking for an email that asks
 * nothing of them.
 *
 * ── WHY 202 AND NOT 200 ──
 * 200 is the honest status — the processing IS complete, which is what 202
 * says it is not — and it was what this returned for about an hour.
 *
 * It is wrong anyway, because this endpoint has a published contract. The AI
 * prompt on the Install page has told every integration, in writing, that
 * success is "202 Accepted", and those integrations are deployed on other
 * people's websites where we cannot see them or change them. An assistant that
 * took that literally and wrote `if (res.status === 202)` would, the moment
 * this changed, start showing a failure message to someone who had just been
 * subscribed — on a client's live page, with nothing reaching us to say so.
 *
 * A slightly coarse status code costs a little precision in our own API. The
 * alternative costs a stranger their signup and a client their trust in the
 * form, silently. `subscribed` in the body carries the distinction exactly,
 * for anything that wants to read it.
 */
function subscribed(req: Request, workspaceName: string): Response {
  if (wantsHtml(req)) {
    return new Response(null, {
      status: 303,
      headers: {
        ...CORS_HEADERS,
        // The page the double opt-in flow reaches after the link is clicked.
        // The same thing is true at this point on this path.
        Location: `${APP_URL.replace(/\/$/, "")}/s/done`,
      },
    });
  }
  return json(
    {
      ok: true,
      /**
       * True here, false on the double opt-in path. The precise signal, in the
       * place where adding one breaks nobody — a field an old integration does
       * not read cannot mislead it.
       */
      subscribed: true,
      message: SUBSCRIBED_MESSAGE,
      workspace: workspaceName,
    },
    { status: 202, headers: CORS_HEADERS },
  );
}

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
    {
      ok: true,
      // False here: a confirmation has been sent and nobody is on the list yet.
      // Both paths carry this field so reading it is never a guess about which
      // one answered.
      subscribed: false,
      message: ACCEPTED_MESSAGE,
      workspace: workspaceName,
    },
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
