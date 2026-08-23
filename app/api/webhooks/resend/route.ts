import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { ticketMessages } from "@/db/schema";
import { verifySvixSignature } from "@/lib/svix";
import { RANK, statusForEvent, shouldSuppressAddress } from "@/lib/delivery-events";

/**
 * POST /api/webhooks/resend — delivery events for TRANSACTIONAL mail.
 *
 * Ticket replies and auto-acknowledgements go out through Resend. Until 23
 * August 2026 nothing recorded what happened to them: a reply to a dead
 * address failed and nobody was told, because the provider's id was discarded
 * at send time, so an event naming it had nothing to match against.
 *
 * Newsletters are a separate path entirely — SES, with its own webhook. Do not
 * merge them: different providers, different payloads, different reputations,
 * and a bug in one should not be able to silence the other.
 *
 * ── THE SIGNATURE IS THE WHOLE OF THE AUTHORISATION ──
 * This endpoint is public and it writes. It FAILS CLOSED: with no
 * RESEND_WEBHOOK_SIGNING_SECRET every request is refused rather than trusted.
 * Same posture as the inbound and Stripe webhooks.
 *
 * The RAW body is verified, not a reparsed one — re-serialising the payload
 * invalidates a perfectly good signature and produces a mystery 400 that looks
 * like a provider fault.
 *
 * ── IT ANSWERS 200 TO THINGS IT IGNORES ──
 * An unrecognised event type, or one about a message we have never seen, gets
 * a 200. A non-2xx makes Resend retry and eventually disable the endpoint,
 * which would take down the events we DO handle along with the ones we do not.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    bounce?: { type?: string; subType?: string };
  };
};

/**
 * The ordering rule, as SQL, GENERATED FROM `RANK`.
 *
 * Built from the same object canAdvance() uses rather than hand-written, so
 * the database's idea of the order and the application's cannot drift apart.
 * Hand-copying it here would work on the day and rot the first time a status
 * is added — the sort of divergence that shows up as one bounced message in a
 * thousand quietly reading "delivered".
 */
const rankSql = sql`CASE ${ticketMessages.deliveryStatus} ${sql.join(
  Object.entries(RANK).map(([status, rank]) => sql`WHEN ${status} THEN ${rank}`),
  sql` `,
)} ELSE -1 END`;

export async function POST(req: Request): Promise<Response> {
  /*
   * Its OWN secret, falling back to the inbound one.
   *
   * Resend issues a separate signing secret per webhook ENDPOINT, and delivery
   * events are necessarily a second endpoint (this path) from the one that
   * receives mail (/api/inbound). Reusing RESEND_WEBHOOK_SIGNING_SECRET
   * verbatim would therefore reject every event with a signature that is
   * perfectly valid — a failure that looks exactly like an attack in the logs
   * and is really a config mistake.
   *
   * The fallback is kept because Resend CAN be configured with one endpoint
   * subscribed to every event type, and because a deployment that has not yet
   * been split should degrade to "wrong secret, refuses" rather than
   * "no secret, refuses" — the log line then points at the right thing.
   */
  const secret =
    process.env.RESEND_DELIVERY_WEBHOOK_SIGNING_SECRET ??
    process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    console.error(
      "[resend-webhook] refusing: set RESEND_DELIVERY_WEBHOOK_SIGNING_SECRET " +
        "(the signing secret of the Resend endpoint pointed at this path)",
    );
    return new Response("Not configured", { status: 503 });
  }

  const raw = await req.text();
  if (!verifySvixSignature(raw, req.headers, secret)) {
    console.warn("[resend-webhook] bad signature");
    return new Response("Bad signature", { status: 400 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw) as ResendEvent;
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const type = event.type ?? "";
  const providerId = event.data?.email_id;
  if (!providerId) {
    console.warn("[resend-webhook] %s with no email_id", type || "(no type)");
    return new Response("ok", { status: 200 });
  }

  const next = statusForEvent(type);

  if (next) {
    /*
     * ONE statement, with the ordering rule inside it.
     *
     * Reading the current status and then writing it back would race two
     * events for the same message against each other — they arrive
     * concurrently and are retried — and the loser could write a stale status
     * over a newer one. Putting the rank comparison in the WHERE clause makes
     * the database arbitrate, which also means a redelivered webhook matches
     * no rows and is a no-op rather than a write.
     */
    const updated = await db
      .update(ticketMessages)
      .set({ deliveryStatus: next })
      .where(
        and(
          eq(ticketMessages.providerMessageId, providerId),
          or(isNull(ticketMessages.deliveryStatus), sql`${rankSql} < ${RANK[next]}`),
        ),
      )
      .returning({ id: ticketMessages.id });

    if (updated.length === 0) {
      // Either we have never seen this id — mail sent before ids were stored,
      // or from something else on the same Resend account — or the status is
      // already at or past this one. Neither is an error.
      console.info(
        "[resend-webhook] %s for %s changed nothing (unknown id, or already past %s)",
        type,
        providerId,
        next,
      );
    } else {
      console.info("[resend-webhook] %s → %s", providerId, next);
    }
  }

  /*
   * Suppression is deliberately NOT wired up here, and this logs rather than
   * doing it silently.
   *
   * `suppressions` is keyed by (workspace_id, email) and exists for the
   * NEWSLETTER path. Feeding a transactional bounce into it would stop the
   * marketing sender writing to somebody whose support address merely had a
   * full mailbox — and worse, a shared list means it could block a business
   * replying to their own customer's open enquiry. Different system,
   * different consent, different consequence.
   *
   * What a permanent transactional bounce SHOULD do is surface on the contact,
   * beside the mistyped-address warning. That needs per-contact deliverability
   * state, which is a schema decision, so it is on the board rather than
   * guessed at here.
   */
  if (shouldSuppressAddress(type, event.data?.bounce?.type)) {
    console.warn(
      "[resend-webhook] %s for %s is grounds for suppression, but transactional suppression is not wired up — see the note in this file",
      type,
      providerId,
    );
  }

  return new Response("ok", { status: 200 });
}
