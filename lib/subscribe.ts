import { createHmac, timingSafeEqual } from "node:crypto";
import { looksLikeEmail, normaliseEmail } from "./newsletter";

/**
 * Newsletter signup — the PURE half.
 *
 * Nothing in this file touches the database, the network, or `process.env`.
 * Same three reasons as lib/newsletter.ts, and one more that is specific to
 * this feature:
 *
 *  1. `db/index.ts` throws at import time when DATABASE_URL is unset, so
 *     anything reaching it cannot be tested in CI. The rules that decide
 *     whether a stranger's POST becomes a subscriber are exactly the rules
 *     that most need a test, so they live here.
 *  2. The secret used to sign confirmation tokens is PASSED IN, never read.
 *     A module that reads its own key cannot be tested against a known key,
 *     and cannot be reviewed for what it does when the key is missing.
 *  3. It stays importable without `server-only`, which keeps the honeypot and
 *     validation rules quotable in either direction if a client component ever
 *     needs them.
 *
 * The IO half — the confirmation email and the single workspace-scoped
 * statement that actually creates the subscriber — is in lib/subscribe-store.ts.
 *
 * ── WHY THERE IS NO "PENDING SUBSCRIBER" ROW ──
 *
 * Double opt-in is normally implemented by writing a row at submission time
 * with status='pending' and a confirmation token beside it. `db/schema.ts` has
 * neither: `SubscriberStatus` is subscribed | unsubscribed | bounced |
 * complained, and `subscribers` carries no token column. Adding them is a
 * migration, and this branch does not own the schema.
 *
 * So the pending state is carried entirely by the CONFIRMATION LINK, as a
 * signed, self-describing token. That is not a workaround dressed up as a
 * design — it is strictly better for the thing this feature is most exposed
 * to. An unauthenticated endpoint on the open internet that writes a row per
 * POST is a way to fill somebody else's subscriber table with junk, and the
 * junk is indistinguishable from real pending signups. Here, an unconfirmed
 * submission writes NOTHING. A thousand submissions of a competitor's address
 * leave a thousand rows of nothing. The first byte hits the database only when
 * a human has clicked a link that arrived in the mailbox they claimed.
 *
 * The costs, stated plainly: there is no server-side record of pending
 * signups (so no "resend confirmation" and no pending count in the dashboard),
 * the token cannot be revoked before it expires, and rotating the signing
 * secret invalidates every confirmation link in flight. All three are
 * acceptable at this size; none of them is a safety property.
 */

// ── Field limits ─────────────────────────────────────────────────

/** RFC 5321 caps a path at 256 including the angle brackets. */
export const SUBSCRIBER_EMAIL_MAX = 254;
export const SUBSCRIBER_NAME_MAX = 120;
/** The page URL recorded as consent evidence. Long enough for a real URL. */
export const CONSENT_SOURCE_MAX = 300;

/**
 * How long a confirmation link stays usable.
 *
 * Long, deliberately. The failure mode of a short window is a real person
 * clicking a real link and being told to start again — which is the moment
 * most of them give up — and an expired token is not a security control here:
 * the token authorises adding YOUR OWN address to a list you asked to join.
 * The window exists so a link that leaks out of an old mailbox years later
 * cannot be replayed, not to hurry anybody.
 */
export const CONFIRM_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// ── Honeypot ─────────────────────────────────────────────────────

/**
 * Field names that must arrive EMPTY.
 *
 * A hidden input that no sighted user sees and no screen reader announces
 * (`aria-hidden` + `tabindex="-1"` + off-screen, never `display:none` on the
 * input alone — some bots skip those). Naive form-fillers populate every input
 * they can find; a non-empty value here is a bot admitting it.
 *
 * Two names rather than one because the trap is only as good as its label:
 * "website" and "company" are the two a generic filler is most likely to
 * recognise and complete.
 *
 * This is a filter, not a defence. It stops commodity spam bots and nothing
 * else — anything written against THIS form will simply leave the fields
 * alone. The rate limits are what bound a determined attacker; see
 * app/api/subscribe/[key]/route.ts.
 */
export const HONEYPOT_FIELDS = ["website", "company"] as const;

/**
 * True when the submission looks automated.
 *
 * ABSENT is fine — the JSON API is documented without these fields and a
 * legitimate integration will not send them. Only a PRESENT and NON-EMPTY
 * value trips it. Whitespace does not count: some browsers autofill a space.
 */
export function isHoneypotTripped(fields: Record<string, string>): boolean {
  return HONEYPOT_FIELDS.some((name) => (fields[name] ?? "").trim() !== "");
}

// ── Input ────────────────────────────────────────────────────────

export type SignupInput = {
  /** Normalised (lower-cased, trimmed). Never the raw string. */
  email: string;
  /** Null when not supplied or not usable — never an empty string. */
  name: string | null;
};

export type SignupParseResult =
  | { ok: true; value: SignupInput }
  | { ok: false; error: string };

/**
 * Validate a signup submission.
 *
 * The error strings are written to be shown to a stranger on someone else's
 * website, so they say what to do rather than which field failed a regex.
 *
 * Note what is NOT rejected here: disposable domains, role addresses
 * (info@, sales@), and addresses that have signed up before. Guessing at those
 * rejects real people, and the double opt-in already answers the only question
 * that matters — can whoever holds this mailbox be bothered to click.
 */
export function parseSignupInput(fields: {
  email?: unknown;
  name?: unknown;
}): SignupParseResult {
  const email = normaliseEmail(String(fields.email ?? ""));
  if (!email) {
    return { ok: false, error: "Please enter your email address." };
  }
  if (email.length > SUBSCRIBER_EMAIL_MAX || !looksLikeEmail(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const rawName = String(fields.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUBSCRIBER_NAME_MAX);
  // An address in the name box is the commonest form-filler mistake and it
  // produces "Hi bob@acme.co," in every future campaign — the tell of a spam
  // blast. firstNameFrom() already refuses to greet with it; dropping it here
  // means we never store the lie in the first place.
  const name = rawName && !rawName.includes("@") ? rawName : null;

  return { ok: true, value: { email, name } };
}

// ── Consent provenance ───────────────────────────────────────────

/**
 * Where the consent was given, as evidence.
 *
 * `subscribers.consentSource` is free text meant to answer a regulator's "show
 * me". The honest answer is the page the form was on — so it is taken from the
 * browser's own `Origin`/`Referer` headers, NOT from a field in the body.
 *
 * That distinction is the whole function. A `source` field in the POST body is
 * written by whoever wrote the page, and on this endpoint that is not
 * necessarily the workspace owner: anybody can POST to it. Storing an
 * attacker-supplied string as proof of consent is worse than storing nothing,
 * because it looks like proof. `Origin` is set by the browser and cannot be
 * changed by page script; `Referer` can be suppressed but not forged by a
 * page. Neither survives a hand-rolled curl, which is exactly why the result
 * may be null.
 *
 * NULL IS A VALID ANSWER and is returned whenever we do not actually know.
 * db/schema.ts: "Never backfill these on import — an import with no provenance
 * is an import we cannot lawfully send to." Inventing "website form" here
 * would be that backfill, performed at write time.
 */
export function consentSourceFrom(headers: {
  origin?: string | null;
  referer?: string | null;
}): string | null {
  // Referer first: it names the PAGE, which is what evidence needs. Origin is
  // only the scheme+host and is the fallback when the referrer policy stripped
  // the path (increasingly the default).
  for (const candidate of [headers.referer, headers.origin]) {
    const raw = (candidate ?? "").trim();
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    // The query string is dropped: it routinely carries session ids, UTM
    // parameters and occasionally the person's own email, and none of that is
    // evidence of consent. Origin + path is.
    return `${url.origin}${url.pathname}`.slice(0, CONSENT_SOURCE_MAX);
  }
  return null;
}

// ── Confirmation token ───────────────────────────────────────────

/**
 * What the confirmation link carries.
 *
 * Short keys because this is base64'd into a URL that has to survive a mail
 * client's line-wrapping.
 */
export type ConfirmPayload = {
  /** Workspace the signup was for. */
  workspaceId: number;
  /** Normalised address. */
  email: string;
  name: string | null;
  /** Consent evidence captured at submission; null when genuinely unknown. */
  consentSource: string | null;
  /** Submission time, ms. NOT the consent time — see the store module. */
  issuedAt: number;
  /**
   * 128 random bits from generateUnsubscribeToken().
   *
   * It authorises nothing on its own — the HMAC is what makes the token
   * unforgeable. It is here so that two signups for the same address produce
   * two DIFFERENT links, which keeps the doctrine in lib/tokens.ts true:
   * a token is never a stable function of an id, an address or a timestamp,
   * so holding one URL tells you nothing about anybody else's.
   */
  nonce: string;
};

/**
 * Domain separation.
 *
 * The signing key may be shared with another purpose (see resolveSigningSecret
 * in lib/subscribe-store.ts). Mixing a constant that names THIS use into the
 * signed content means a signature produced for one purpose cannot be
 * presented as a signature for the other, even under one key.
 */
const TOKEN_DOMAIN = "postbox.subscribe.confirm.v1";

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(body: string, secret: string): string {
  return b64url(
    createHmac("sha256", secret).update(`${TOKEN_DOMAIN}.${body}`).digest(),
  );
}

/**
 * Build the token that goes in the confirmation link.
 *
 * `secret` is passed in and must be a real secret; see the caller. The token
 * is `<base64url(payload)>.<base64url(hmac)>` — self-describing, so no row
 * has to exist for an unconfirmed signup, and unforgeable, so nobody can mint
 * one for an address they do not control.
 */
export function encodeConfirmToken(
  payload: ConfirmPayload,
  secret: string,
): string {
  const body = b64url(
    JSON.stringify({
      w: payload.workspaceId,
      e: payload.email,
      n: payload.name,
      s: payload.consentSource,
      t: payload.issuedAt,
      x: payload.nonce,
    }),
  );
  return `${body}.${sign(body, secret)}`;
}

export type ConfirmTokenResult =
  | { ok: true; payload: ConfirmPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify and decode a confirmation token.
 *
 * ── ORDER MATTERS ──
 * The signature is checked BEFORE the payload is trusted for anything,
 * including its own expiry. Reading `t` out of an unverified payload and
 * deciding on it would let anyone hand us any expiry they liked.
 *
 * ── ONE OUTCOME FOR THE CALLER ──
 * The three failure reasons are for logs. Every caller in this feature renders
 * the same page and the same status for all of them: a token that fails is a
 * token, not a person, and distinguishing "expired" from "forged" tells a
 * prober which half of their guess was right.
 *
 * `now` is injectable so expiry is testable without touching the clock.
 */
export function decodeConfirmToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): ConfirmTokenResult {
  // Bound the work before any of it happens. `token` is a path segment from a
  // stranger; base64-decoding and JSON-parsing an unbounded string is free
  // CPU for whoever sends it.
  if (typeof token !== "string" || token.length < 8 || token.length > 4096) {
    return { ok: false, reason: "malformed" };
  }
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(provided)) {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(body, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length is compared first because timingSafeEqual THROWS on a mismatch —
  // an uncaught throw here would turn a malformed token into a 500, and the
  // difference between 500 and 200 is itself an oracle.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "malformed" };
  }
  const o = raw as Record<string, unknown>;

  const workspaceId = typeof o.w === "number" ? o.w : NaN;
  const email = typeof o.e === "string" ? normaliseEmail(o.e) : "";
  const issuedAt = typeof o.t === "number" ? o.t : NaN;
  const nonce = typeof o.x === "string" ? o.x : "";
  if (
    !Number.isInteger(workspaceId) ||
    workspaceId <= 0 ||
    !email ||
    !looksLikeEmail(email) ||
    email.length > SUBSCRIBER_EMAIL_MAX ||
    !Number.isFinite(issuedAt) ||
    !nonce
  ) {
    return { ok: false, reason: "malformed" };
  }

  // A token dated in the future is either a clock skew or a forgery attempt
  // against an expiry we cannot verify; a small allowance, then refuse.
  if (issuedAt - now > 5 * 60 * 1000) {
    return { ok: false, reason: "expired" };
  }
  if (now - issuedAt > CONFIRM_TOKEN_TTL_MS) {
    return { ok: false, reason: "expired" };
  }

  const name =
    typeof o.n === "string" && o.n.trim()
      ? o.n.trim().slice(0, SUBSCRIBER_NAME_MAX)
      : null;
  const consentSource =
    typeof o.s === "string" && o.s.trim()
      ? o.s.trim().slice(0, CONSENT_SOURCE_MAX)
      : null;

  return {
    ok: true,
    payload: { workspaceId, email, name, consentSource, issuedAt, nonce },
  };
}

// ── URLs ─────────────────────────────────────────────────────────

/**
 * The hosted signup page for one workspace. `appUrl` is passed in — this
 * module never reads lib/config, for the reason in the header.
 */
export function hostedSignupUrl(appUrl: string, apiKey: string): string {
  return `${appUrl.replace(/\/$/, "")}/s/${encodeURIComponent(apiKey)}`;
}

/**
 * The link put in the confirmation email.
 *
 * It is a GET to a PAGE, not to the endpoint that writes. The write happens on
 * a POST from a button on that page, for the same reason app/u/[token]/route.ts
 * refuses to act on GET: corporate mail scanners and link-preview bots fetch
 * every URL in a message. A GET that subscribed would mean the scanner
 * consented on the recipient's behalf — which destroys the only thing double
 * opt-in exists to produce, namely evidence that a human chose this.
 */
export function confirmUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/s/confirm?t=${encodeURIComponent(token)}`;
}

// ── Confirmation email body ──────────────────────────────────────

/**
 * The transactional confirmation email, as plain text.
 *
 * Pure so the wording is reviewable and testable. Three things it must do, all
 * of them because the recipient may not have asked for this at all:
 *
 *  - name the sender, so an unexpected email is attributable;
 *  - say plainly that ignoring it means nothing happens. This is the sentence
 *    that turns a stranger's "who are these people" into a shrug instead of a
 *    spam report, and a spam report on a shared sending domain is charged to
 *    every other tenant's ticket replies;
 *  - promise nothing about what will be sent, because we do not know.
 */
export function confirmationEmailText(input: {
  workspaceName: string;
  confirmUrl: string;
}): string {
  return `Please confirm your email address.

Someone — we hope you — asked for ${input.workspaceName} to send email to this address. Nothing will be sent until you confirm:

${input.confirmUrl}

If that wasn't you, ignore this email. You won't be added to anything and we won't email you again about it.

— Sent by Postbox on behalf of ${input.workspaceName}`;
}

export function confirmationEmailSubject(workspaceName: string): string {
  return `Confirm your subscription to ${workspaceName}`;
}
