import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { APP_URL, EMAIL_FROM_ADDRESS } from "./config";
import { sendReplyEmail } from "./email";
import {
  confirmUrl,
  confirmationEmailSubject,
  confirmationEmailText,
  encodeConfirmToken,
  type ConfirmPayload,
} from "./subscribe";
import { generateUnsubscribeToken } from "./tokens";

/**
 * Newsletter signup — the IO half.
 *
 * The pure half (validation, the honeypot rule, token encode/decode, the email
 * wording) is lib/subscribe.ts and has no database, no network and no env. This
 * file is everything that has a side effect, and it does exactly two things:
 * send ONE transactional email, and run ONE statement that creates a
 * subscriber.
 *
 * ── IT CANNOT SEND BULK MAIL ──
 *
 * The confirmation goes through `sendReplyEmail` in lib/email.ts — the same
 * Resend path that carries ticket replies, auto-replies and workspace
 * invitations. It deliberately does NOT go through lib/deliver.ts, and this
 * module imports neither the deliverer nor lib/campaign-send.ts.
 *
 * The distinction is not stylistic. A confirmation is transactional: one
 * message, to one address, caused by that address's own submission seconds
 * earlier, containing nothing but the link needed to complete the action.
 * Campaign mail is bulk, and the campaign deliverer is inert on purpose —
 * `CAMPAIGN_DELIVERY_MODE` is unset, so it logs and sends nothing, and that
 * switch is the safety catch on 40,000 messages leaving under our sending
 * domain. Routing confirmations through it would mean either the confirmations
 * never send (double opt-in that cannot opt in) or somebody flips the switch to
 * make them send and unpauses the newsletter as a side effect. Neither is
 * acceptable, so the two paths stay apart.
 *
 * Consequences, accepted: confirmations send from EMAIL_FROM_ADDRESS on the
 * primary domain rather than the marketing subdomain, and they are not counted
 * or throttled by the campaign machinery. Both are correct for transactional
 * mail. The rate limits that bound the volume live at the endpoint.
 *
 * ── TENANCY ──
 *
 * Every statement carries `workspace_id` INSIDE the mutating statement — the
 * lib/labels.ts pattern — never as a check performed first. The workspace is
 * taken from the signed token, which is minted server-side from a workspace
 * looked up by API key; it is never read from a request field.
 */

/**
 * The list a confirmed signup joins.
 *
 * It exists because a campaign cannot be sent without one:
 * lib/campaign-send.ts refuses any campaign whose `list_id IS NULL`, so a
 * subscriber with no list membership is a subscriber nobody can ever mail. The
 * production database has zero lists, which means a signup that only wrote a
 * `subscribers` row would still leave every campaign audience-less — the exact
 * dead end this feature exists to clear.
 *
 * One list per workspace, created on first confirmation, name unique per
 * workspace by index. Clients can rename it, add others, and move people
 * between them from the dashboard; this is only the default landing place, not
 * a special list the code depends on later.
 */
export const SIGNUP_LIST_NAME = "Newsletter signups";
const SIGNUP_LIST_DESCRIPTION =
  "People who confirmed a double opt-in signup form. Created automatically.";

/**
 * `subscribers.source` for this path. The schema's examples are of this shape
 * ("footer_form", "shopify_import") — a machine-readable provenance tag,
 * distinct from `consentSource`, which is the human-readable evidence.
 */
export const SIGNUP_SOURCE = "signup_form";

// ── Signing secret ───────────────────────────────────────────────

/**
 * The HMAC key for confirmation tokens.
 *
 * FAIL CLOSED, exactly like app/api/inbound/route.ts. With no key there is no
 * way to tell a token we minted from one a stranger typed, and the endpoint
 * returns 503 rather than issuing tokens anybody could forge. A missing secret
 * is a deployment fault, not permission to trust everything.
 *
 * `SUBSCRIBE_TOKEN_SECRET` is the variable to set, and it is NOT yet in
 * .env.example or in Vercel — see the note accompanying this work. The
 * fallback to `INBOUND_WEBHOOK_SECRET` exists so the feature is not dead on
 * arrival in an environment that already has one, and is safe only because
 * every signature mixes in a constant naming this use (TOKEN_DOMAIN in
 * lib/subscribe.ts): a signature minted here cannot be replayed as an inbound
 * webhook proof, or the reverse. The placeholder value from .env.example is
 * refused — a shared secret everyone can read from a committed file is not a
 * secret. Reusing a key across two purposes is still worse than not reusing
 * it; set the dedicated variable and this branch stops being reached.
 */
export function resolveSigningSecret(): string | null {
  const dedicated = process.env.SUBSCRIBE_TOKEN_SECRET;
  if (dedicated && dedicated.length >= 16) return dedicated;

  const shared = process.env.INBOUND_WEBHOOK_SECRET;
  if (shared && shared !== "dev-secret-change-me" && shared.length >= 16) {
    return shared;
  }
  return null;
}

// ── Confirmation email ───────────────────────────────────────────

/**
 * Mint a confirmation link and send it.
 *
 * BEST EFFORT, and the caller must not vary its HTTP response on the result.
 * Whether the address bounced, whether Resend was configured, and whether the
 * address is already on the list are all invisible to the submitter by design
 * — see the endpoint's "no oracle" note. A failure is logged and nothing else.
 *
 * Nothing is written to the database here. Until the link is clicked, the only
 * record that this signup happened is the token sitting in one mailbox.
 */
export async function sendConfirmationEmail(input: {
  workspaceId: number;
  workspaceName: string;
  /** The address replies to the confirmation should reach — the client's. */
  workspaceReplyTo: string;
  email: string;
  name: string | null;
  consentSource: string | null;
  secret: string;
}): Promise<{ sent: boolean }> {
  const payload: ConfirmPayload = {
    workspaceId: input.workspaceId,
    email: input.email,
    name: input.name,
    consentSource: input.consentSource,
    issuedAt: Date.now(),
    // 128 bits from the shared generator, so two signups for one address never
    // produce the same link. See ConfirmPayload.nonce.
    nonce: generateUnsubscribeToken(),
  };
  const token = encodeConfirmToken(payload, input.secret);
  const url = confirmUrl(APP_URL, token);

  try {
    const result = await sendReplyEmail({
      from: EMAIL_FROM_ADDRESS,
      fromName: input.workspaceName,
      to: input.email,
      subject: confirmationEmailSubject(input.workspaceName),
      text: confirmationEmailText({
        workspaceName: input.workspaceName,
        confirmUrl: url,
      }),
      // A reply goes to the client, not into a black hole. Somebody who did
      // not sign up will reply to this email rather than click anything, and
      // the sender is the only party who can do something about it.
      replyTo: input.workspaceReplyTo,
    });
    if (!result.sent) {
      console.warn("[subscribe] confirmation not sent:", result.error);
    }
    return { sent: result.sent };
  } catch (err) {
    console.error("[subscribe] confirmation send failed:", err);
    return { sent: false };
  }
}

// ── The write ────────────────────────────────────────────────────

export type ConfirmOutcome = {
  /** The address is on the list now (whether or not this call put it there). */
  subscribed: boolean;
  /** Blocked by a suppression; nothing was written. */
  suppressed: boolean;
  /** A subscribers row already existed, so this call did not create one. */
  existed: boolean;
  /** Did this call record a FRESH consent timestamp? */
  consentRecorded: boolean;
};

/**
 * Turn a verified confirmation into a subscriber. The only write in this
 * feature.
 *
 * ── CONSENT IS RECORDED HERE, NOT AT SUBMISSION ──
 * `consent_at` is `now()` — the moment of CONFIRMATION. The submission time
 * travels in the token and is deliberately not stored: somebody typing an
 * address into a form is not evidence that the person who owns it agreed, and
 * a timestamp taken then would overstate what we can prove. `consent_method`
 * is 'signup_form', which is the closest member of the `ConsentMethod` union
 * in db/schema.ts — the union has no 'double_opt_in' member, and adding one is
 * a schema change this branch does not own. The evidence that it was DOUBLE
 * opt-in is carried in `consent_source`, which is written as the page the form
 * was on plus a marker; when the page is unknown, only the marker is written
 * and nothing is invented about where it came from.
 *
 * ── ONE STATEMENT ──
 * The neon-http driver has no transactions (`drizzle-orm/neon-http` throws on
 * `db.transaction`), so this is one statement with data-modifying CTEs, which
 * Postgres runs in a single snapshot and a single implicit transaction. The
 * subscriber, the default list and the membership row are therefore all
 * created or none are. Split across three round trips, a crash in the middle
 * leaves a subscriber who consented but is on no list — invisible to every
 * campaign, and indistinguishable from someone who never confirmed.
 *
 * ── IDEMPOTENT ──
 * Clicking the link twice is a success and changes nothing the second time.
 * An address that is already 'subscribed' with a consent timestamp KEEPS that
 * timestamp: consent evidence is the date it actually happened, and refreshing
 * it on every click would quietly launder an old consent into a recent one. An
 * address that had unsubscribed and confirmed again DOES get a new timestamp,
 * because that is a new act of consent.
 *
 * ── SUPPRESSION WINS ──
 * A suppressed address is not resurrected — not by this path and not by any
 * other. lib/newsletter.ts `sendability()` states the rule; here it is a
 * `NOT EXISTS` inside both mutating statements rather than a check above them,
 * so a suppression written concurrently cannot be raced past. Someone who
 * reported this sender for spam and then gets signed up again (by themselves,
 * or by an attacker) stays blocked, and the endpoint tells the clicker the
 * same thing either way.
 */
export async function confirmSubscription(input: {
  workspaceId: number;
  email: string;
  name: string | null;
  consentSource: string | null;
  /**
   * The address the CONFIRMATION click came from, or null when the proxy did
   * not tell us. Deliberately the click's IP and not the submission's: this
   * statement records consent at the moment of confirmation (see above), so
   * the IP has to describe the same act. The submitter's IP would be evidence
   * about a different event, filed in a column that claims otherwise.
   */
  consentIp: string | null;
}): Promise<ConfirmOutcome> {
  // The evidence string. The marker is always true — this row can only be
  // written by a click on an emailed link. The page URL is appended only when
  // the browser actually told us one; nothing is guessed.
  const consentSource = input.consentSource
    ? `Double opt-in confirmed from ${input.consentSource}`
    : "Double opt-in confirmed (signup page not recorded)";

  const res = await db.execute(sql`
    WITH blocked AS (
      -- Keyed by email and scoped to the workspace, matched case-insensitively
      -- for the same reason lib/suppressions.ts does: a block that misses on
      -- capitalisation is a send to someone who asked us not to.
      SELECT 1
      FROM suppressions
      WHERE workspace_id = ${input.workspaceId}
        AND lower(btrim(email)) = ${input.email}
    ),
    updated AS (
      UPDATE subscribers s
      SET
        status = 'subscribed',
        unsubscribed_at = NULL,
        -- Never blank an existing name with a signup that omitted one.
        name = COALESCE(${input.name}::text, s.name),
        source = COALESCE(s.source, ${SIGNUP_SOURCE}::text),
        subscribed_at = CASE
          WHEN s.status = 'subscribed' THEN s.subscribed_at
          ELSE now()
        END,
        -- A fresh consent is recorded only when there is not already a
        -- standing one. See the header.
        consent_method = CASE
          WHEN s.status = 'subscribed' AND s.consent_at IS NOT NULL
            THEN s.consent_method
          ELSE 'signup_form'
        END,
        consent_at = CASE
          WHEN s.status = 'subscribed' AND s.consent_at IS NOT NULL
            THEN s.consent_at
          ELSE now()
        END,
        consent_source = CASE
          WHEN s.status = 'subscribed' AND s.consent_at IS NOT NULL
            THEN s.consent_source
          ELSE ${consentSource}::text
        END,
        -- Moves with consent_at, never independently. An IP refreshed against
        -- a timestamp that was not refreshed would describe a click the
        -- timestamp says never happened.
        consent_ip = CASE
          WHEN s.status = 'subscribed' AND s.consent_at IS NOT NULL
            THEN s.consent_ip
          ELSE ${input.consentIp}::text
        END
      -- The workspace predicate is part of the UPDATE, not a check above it.
      WHERE s.workspace_id = ${input.workspaceId}
        AND lower(btrim(s.email)) = ${input.email}
        AND NOT EXISTS (SELECT 1 FROM blocked)
      -- In an UPDATE ... RETURNING, a reference to the target table yields the
      -- NEW value, so "did it already have consent" cannot be read here.
      -- Comparing against now() answers the same question from the other side:
      -- now() is the statement timestamp, so consent_at equals it only when
      -- this statement is what set it.
      RETURNING s.id, (s.consent_at = now()) AS fresh_consent
    ),
    inserted AS (
      INSERT INTO subscribers (
        workspace_id, email, name, status, subscribed_at,
        source, consent_method, consent_at, consent_source, consent_ip
      )
      SELECT
        ${input.workspaceId}, ${input.email}, ${input.name}::text,
        'subscribed', now(),
        ${SIGNUP_SOURCE}::text, 'signup_form', now(), ${consentSource}::text,
        ${input.consentIp}::text
      -- Referencing the CTE, not re-querying subscribers: a second lookup
      -- would read the pre-statement snapshot and insert a duplicate row
      -- alongside the row the "updated" CTE just fixed.
      WHERE NOT EXISTS (SELECT 1 FROM updated)
        AND NOT EXISTS (SELECT 1 FROM blocked)
      -- Race guard only. Two clicks arriving together both find no row; the
      -- unique index on (workspace_id, email) settles it and the loser writes
      -- nothing rather than erroring.
      ON CONFLICT (workspace_id, email) DO NOTHING
      RETURNING id
    ),
    subject AS (
      SELECT id FROM updated
      UNION ALL
      SELECT id FROM inserted
    ),
    target_list AS (
      INSERT INTO lists (workspace_id, name, description)
      SELECT ${input.workspaceId}, ${SIGNUP_LIST_NAME}::text, ${SIGNUP_LIST_DESCRIPTION}::text
      WHERE EXISTS (SELECT 1 FROM subject)
      -- DO UPDATE rather than DO NOTHING so an existing list still RETURNs its
      -- id — the same reason lib/labels.ts touches created_at on conflict.
      -- Setting name to its own value is a no-op write.
      ON CONFLICT (workspace_id, name) DO UPDATE SET name = lists.name
      RETURNING id
    ),
    membership AS (
      INSERT INTO list_subscribers (list_id, subscriber_id)
      SELECT l.id, s.id FROM target_list l, subject s
      ON CONFLICT (list_id, subscriber_id) DO NOTHING
      RETURNING subscriber_id
    )
    SELECT
      (SELECT count(*) FROM subject)::int   AS subject_count,
      (SELECT count(*) FROM blocked)::int   AS blocked_count,
      (SELECT count(*) FROM updated)::int   AS updated_count,
      (SELECT count(*) FROM updated WHERE fresh_consent)::int AS fresh_consent_count
  `);

  const row = res.rows[0] as
    | {
        subject_count: number;
        blocked_count: number;
        updated_count: number;
        fresh_consent_count: number;
      }
    | undefined;

  const subjectCount = row?.subject_count ?? 0;
  const updatedCount = row?.updated_count ?? 0;
  const freshConsent = row?.fresh_consent_count ?? 0;
  return {
    subscribed: subjectCount > 0,
    suppressed: (row?.blocked_count ?? 0) > 0,
    existed: updatedCount > 0,
    // Either an existing row was given a new consent timestamp, or a row was
    // inserted (which always carries one). Logging only — see the endpoint.
    consentRecorded: freshConsent > 0 || subjectCount - updatedCount > 0,
  };
}
