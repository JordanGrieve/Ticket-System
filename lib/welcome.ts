import { createHmac, timingSafeEqual } from "node:crypto";
import {
  renderCampaign,
  type Brand,
  type RenderedEmail,
  type SenderIdentity,
} from "./newsletter";

/**
 * The thank-you a new subscriber gets the moment they confirm.
 *
 * Pure: no database, no email provider, no clock of its own. lib/welcome-store
 * is the IO half. The rules that could be wrong live here so they can be run.
 *
 * ── WHY THIS EXISTS ──
 * Until 11 Sep 2026 a person who signed up for a client's newsletter received
 * exactly one email ever — "Confirm your subscription" — and then nothing
 * until the client happened to write a campaign. The moment somebody has just
 * asked to hear from a business is the moment they are most willing to, and
 * the product said nothing.
 *
 * ── IT RENDERS THROUGH renderCampaign, ON PURPOSE ──
 * Not a second renderer. Every legal guarantee a campaign carries — the
 * postal address block, the unsubscribe footer, the sign-off, the merge tags
 * — is enforced in one place, and `renderCampaign` throws rather than render
 * a footer with no address. A welcome email is marketing mail; a second
 * renderer is how one of the two quietly stops carrying an address.
 */

export const DEFAULT_WELCOME_SUBJECT = "Thanks for subscribing to {company}";

/**
 * Deliberately short, and deliberately free of square brackets.
 *
 * The campaign starter body ships with `[bracketed placeholders]` because a
 * campaign is written before it is sent and the brackets are a reminder. This
 * one sends unattended the first time somebody subscribes, so anything left
 * unedited goes to a real customer. Every sentence here is true of any
 * business and safe to send exactly as written.
 *
 * ── ONE LINE PER PARAGRAPH, AND THAT IS NOT A STYLE CHOICE ──
 * The renderer turns a single newline into a line break and a blank line into
 * a paragraph, so source text wrapped at 78 characters for readability reaches
 * the reader wrapped at 78 characters — which is not where their mail client
 * would have wrapped it. The first real send of this email, on 11 Sep 2026,
 * broke mid-sentence after "at the bottom of" in Gmail. Long lines here,
 * always; `tests/welcome.test.ts` fails on a mid-sentence break.
 */
export const DEFAULT_WELCOME_BODY = [
  "Hi {first_name},",
  "",
  "Thanks for signing up — you're on the list.",
  "",
  "You'll hear from us when there's something worth telling you about, and not otherwise. If you ever change your mind, the unsubscribe link at the bottom of any email takes one click and takes effect immediately.",
  "",
  "Thanks again,",
  "{company}",
].join("\n");

// ── The unsubscribe token ────────────────────────────────────────

/**
 * A welcome email needs an unsubscribe link, and it has no campaign row to
 * hang one on.
 *
 * Campaign unsubscribe tokens are random strings stored on
 * `campaign_recipients`. There is no equivalent row here — the welcome is not
 * a campaign — so the token is SIGNED rather than stored: it carries the
 * workspace and the address, and the signature proves we issued it. Nothing to
 * write, nothing to clean up, and no migration to sequence against a deploy.
 *
 * Domain-separated from the confirmation token in lib/subscribe.ts. The two
 * may share a signing key, and a signature minted to confirm a subscription
 * must not also cancel one.
 */
const TOKEN_DOMAIN = "postbox.unsubscribe.welcome.v1";

/** Marks a token as ours before any HMAC work is done. See decode below. */
export const WELCOME_TOKEN_PREFIX = "w1.";

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
 * `w1.<payload>.<signature>`, where the payload is the workspace and the
 * address the link should stop.
 *
 * No expiry, unlike the confirmation token. An unsubscribe link has to work
 * for as long as the email exists in somebody's mailbox — a person finding a
 * two-year-old welcome email and pressing unsubscribe must be unsubscribed,
 * not shown an error. The confirmation token expires because a stale one
 * would create a subscription nobody remembers asking for; the risk runs the
 * other way here.
 */
export function encodeWelcomeUnsubToken(
  workspaceId: number,
  email: string,
  secret: string,
): string {
  const payload = b64url(
    JSON.stringify({ w: workspaceId, e: email.trim().toLowerCase() }),
  );
  return `${WELCOME_TOKEN_PREFIX}${payload}.${sign(payload, secret)}`;
}

export type WelcomeTokenResult =
  | { ok: true; workspaceId: number; email: string }
  | { ok: false };

/**
 * Verify and unpack. Returns a single failure shape for every kind of bad
 * token — malformed, wrong signature, wrong domain — because telling a prober
 * which one it was tells them how to make progress.
 */
export function decodeWelcomeUnsubToken(
  token: string,
  secret: string,
): WelcomeTokenResult {
  if (!token.startsWith(WELCOME_TOKEN_PREFIX)) return { ok: false };
  const rest = token.slice(WELCOME_TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return { ok: false };

  const payload = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);
  const expected = sign(payload, secret);

  // Length first: timingSafeEqual throws on a length mismatch, and an
  // exception is itself a signal about the input.
  if (signature.length !== expected.length) return { ok: false };
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { ok: false };
  }

  try {
    const parsed: unknown = JSON.parse(fromB64url(payload).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return { ok: false };
    const { w, e } = parsed as { w?: unknown; e?: unknown };
    if (typeof w !== "number" || !Number.isInteger(w) || w <= 0) {
      return { ok: false };
    }
    if (typeof e !== "string" || e.length === 0) return { ok: false };
    return { ok: true, workspaceId: w, email: e };
  } catch {
    return { ok: false };
  }
}

// ── Rendering ────────────────────────────────────────────────────

/**
 * The welcome email, rendered exactly as a one-recipient campaign.
 *
 * Throws when `sender` carries no postal address — that is `renderCampaign`'s
 * behaviour and it is inherited on purpose. The caller gates on
 * `mailableSender()` first, so the throw is a backstop rather than the
 * control flow.
 */
export function renderWelcome(input: {
  subject: string;
  body: string;
  recipient: { email: string; name: string | null };
  workspaceName: string;
  unsubscribeUrl: string;
  sender: SenderIdentity;
  brand: Brand;
}): RenderedEmail {
  return renderCampaign({
    campaign: {
      subject: input.subject,
      body: input.body,
      // No preheader. The subject of a welcome email says the whole thing,
      // and an empty preview line lets the client see their own opening
      // sentence in the inbox list instead of a second summary of it.
      preheader: null,
      // Branded, so it inherits the workspace's accent colour and sign-off.
      // A thank-you that looks nothing like the newsletter it introduces is a
      // worse first impression than no thank-you.
      templateKey: "branded",
    },
    recipient: input.recipient,
    workspaceName: input.workspaceName,
    unsubscribeUrl: input.unsubscribeUrl,
    sender: input.sender,
    brand: input.brand,
    // Stated rather than omitted. A welcome email carries neither — there is
    // no column for either on welcome_emails — and saying so is what
    // tests/render-campaign-callers.test.ts requires of every call site,
    // because the two that quietly left them out both shipped as bugs.
    hero: null,
    products: [],
  });
}
