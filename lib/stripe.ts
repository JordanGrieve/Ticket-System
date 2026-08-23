import "server-only";
import Stripe from "stripe";
import type { PlanId } from "./pricing";

/**
 * Stripe, and the mapping between its ids and ours.
 *
 * ── EVERYTHING HERE IS OPTIONAL AT BOOT ──
 * The keys are read lazily, never at module scope. Reading them at import time
 * would mean any route that transitively touches billing fails to build
 * without a Stripe account — which is how a missing env var takes down the
 * inbox rather than just the checkout button. `stripeClient()` returns null
 * when unconfigured and every caller is expected to handle that, exactly like
 * the campaign deliverer treats absent AWS credentials as "log only" rather
 * than as consent to send.
 */

let cached: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, {
      // Pinned. An unpinned version means Stripe can change the shape of a
      // webhook payload under a running deployment, and the first anybody
      // knows is a subscription that silently stops being renewed.
      apiVersion: "2026-07-29.dahlia",
      typescript: true,
    });
  }
  return cached;
}

/**
 * Our plan id → the Stripe Price id, from the environment.
 *
 * Env vars rather than hardcoded ids because test and live mode have entirely
 * different price ids, and hardcoding either guarantees that one of the two
 * environments charges nothing or charges wrongly.
 */
export function stripePriceId(plan: PlanId): string | null {
  const map: Record<PlanId, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    growth: process.env.STRIPE_PRICE_GROWTH,
    business: process.env.STRIPE_PRICE_BUSINESS,
  };
  return map[plan] ?? null;
}

/**
 * Stripe Price id → our plan id.
 *
 * The webhook receives a price, not a plan, so this is what turns "they paid
 * for something" into "they are entitled to Growth". If it returns null the
 * webhook must NOT guess: granting a plan on an unrecognised price is how a
 * £12 subscription becomes Business access.
 */
export function planForPriceId(priceId: string): PlanId | null {
  const pairs: Array<[PlanId, string | undefined]> = [
    ["starter", process.env.STRIPE_PRICE_STARTER],
    ["growth", process.env.STRIPE_PRICE_GROWTH],
    ["business", process.env.STRIPE_PRICE_BUSINESS],
  ];
  for (const [plan, id] of pairs) {
    if (id && id === priceId) return plan;
  }
  return null;
}
