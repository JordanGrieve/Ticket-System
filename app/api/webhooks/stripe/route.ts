import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces, type PlanState } from "@/db/schema";
import { stripeClient } from "@/lib/stripe";
import { planForPriceId } from "@/lib/stripe";

/**
 * Stripe webhooks: the only thing that grants a paid plan.
 *
 * ── THE SIGNATURE IS THE WHOLE OF THE AUTHORISATION ──
 * This endpoint is public and it upgrades accounts. Without signature
 * verification it is a free-upgrade button that anybody who can read the URL
 * may press. Same discipline as app/api/webhooks/ses: verify first, parse
 * second, and never trust a field from an unverified body.
 *
 * It FAILS CLOSED. With no STRIPE_WEBHOOK_SECRET set, every request is
 * refused — an unconfigured deployment must not process billing events on
 * trust. That is the same choice the SES webhook makes about its topic ARN.
 *
 * ── WHY THE PLAN IS DERIVED FROM THE PRICE, NOT SENT ──
 * The event says which Price was bought. planForPriceId maps that to one of
 * ours, and returns null for anything unrecognised. On null we record nothing
 * and log loudly: granting a plan on an unknown price is how a £12
 * subscription becomes Business access.
 *
 * ── IDEMPOTENCY ──
 * Stripe retries, and delivers events out of order. Every write here is a
 * full overwrite of the billing columns derived from the subscription's
 * CURRENT state, not an increment or an extension — so handling the same
 * event twice, or an old event after a new one, converges rather than
 * compounds. There is no "add a month" anywhere, deliberately.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !secret) {
    console.error(
      "[stripe-webhook] refusing: %s not configured",
      !stripe ? "STRIPE_SECRET_KEY" : "STRIPE_WEBHOOK_SECRET",
    );
    return new Response("Not configured", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  // The RAW body. Stripe signs the exact bytes, so anything that re-serialises
  // the payload — req.json() and back — invalidates a perfectly good signature
  // and produces a mystery 400.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.warn(
      "[stripe-webhook] bad signature: %s",
      err instanceof Error ? err.message : "unknown",
    );
    return new Response("Bad signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const workspaceId = Number(session.client_reference_id);
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (!Number.isInteger(workspaceId) || !subscriptionId) {
          console.warn(
            "[stripe-webhook] checkout.session.completed with no workspace or subscription",
          );
          break;
        }

        // Re-fetch rather than trusting the session's expanded shape: the
        // subscription is the source of truth for period end and status, and
        // a session can complete before the subscription is fully settled.
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscription(workspaceId, sub);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        // These arrive with no checkout session, which is why the workspace id
        // is written into subscription metadata at checkout time.
        const workspaceId = Number(sub.metadata?.workspaceId);
        if (!Number.isInteger(workspaceId)) {
          console.warn(
            "[stripe-webhook] %s with no workspaceId in metadata (sub %s)",
            event.type,
            sub.id,
          );
          break;
        }
        await applySubscription(workspaceId, sub);
        break;
      }

      default:
        // Everything else is acknowledged and ignored. Returning a non-2xx for
        // an event we simply do not handle makes Stripe retry it forever and
        // eventually disable the endpoint — taking the events we DO handle
        // down with it.
        break;
    }
  } catch (err) {
    // 500 so Stripe retries. A transient database failure must not silently
    // lose somebody's upgrade.
    console.error(
      "[stripe-webhook] handler failed for %s: %s",
      event.type,
      err instanceof Error ? err.message : "unknown",
    );
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

/**
 * Write a subscription's current state onto the workspace.
 *
 * A full overwrite, always. See the idempotency note above.
 */
async function applySubscription(
  workspaceId: number,
  sub: Stripe.Subscription,
): Promise<void> {
  const item = sub.items.data[0];
  const priceId = item?.price?.id;
  const plan = priceId ? planForPriceId(priceId) : null;

  // An unrecognised price is not an upgrade. Record the status so support can
  // see something happened, but do not touch `plan` — inventing entitlement
  // from a price we cannot identify is the one mistake here that costs money.
  if (!plan) {
    console.error(
      "[stripe-webhook] unrecognised price %s on subscription %s — plan NOT changed",
      priceId ?? "(none)",
      sub.id,
    );
    await db
      .update(workspaces)
      .set({ subscriptionStatus: sub.status })
      .where(eq(workspaces.id, workspaceId));
    return;
  }

  // A subscription that has ended returns the workspace to 'trial'. The trial
  // clock is NOT reset — trialStartedAt is untouched — so a lapsed customer
  // does not receive a fresh fortnight by cancelling. lib/trial.ts will find
  // that trial long expired and block sending, which is correct: they had the
  // trial, then they paid, then they stopped.
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";

  // `current_period_end` lives on the subscription ITEM in recent API
  // versions, not on the subscription. Reading it off the wrong object yields
  // undefined, which would look exactly like a lapsed subscription and cut off
  // a paying customer.
  const periodEnd = item?.current_period_end ?? null;

  await db
    .update(workspaces)
    .set({
      plan: (ended ? "trial" : plan) as PlanState,
      stripeSubscriptionId: ended ? null : sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    })
    .where(eq(workspaces.id, workspaceId));

  console.log(
    "[stripe-webhook] workspace %d → plan=%s status=%s",
    workspaceId,
    ended ? "trial" : plan,
    sub.status,
  );
}
