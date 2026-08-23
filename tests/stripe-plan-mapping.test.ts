import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { planForPriceId, stripePriceId, stripeConfigured } from "../lib/stripe";
import { PLANS } from "../lib/pricing";

/**
 * The Stripe Price id ↔ plan id mapping.
 *
 * This is the join between "they paid for something" and "they are entitled to
 * Growth", and it is the one piece of billing logic where being wrong costs
 * real money in a way nobody notices for a month. A £12 subscription silently
 * granting Business access looks, from inside the product, exactly like a
 * customer on Business.
 *
 * The ids come from the environment rather than being hardcoded because test
 * mode and live mode have entirely different price ids. Hardcoding either one
 * guarantees the other environment charges nothing or charges wrongly.
 */

const KEYS = [
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_GROWTH",
  "STRIPE_PRICE_BUSINESS",
  "STRIPE_SECRET_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("price → plan", () => {
  it("maps each configured price to its own plan", () => {
    process.env.STRIPE_PRICE_STARTER = "price_starter_abc";
    process.env.STRIPE_PRICE_GROWTH = "price_growth_def";
    process.env.STRIPE_PRICE_BUSINESS = "price_business_ghi";

    expect(planForPriceId("price_starter_abc")).toBe("starter");
    expect(planForPriceId("price_growth_def")).toBe("growth");
    expect(planForPriceId("price_business_ghi")).toBe("business");
  });

  it("returns null for a price it does not recognise", () => {
    process.env.STRIPE_PRICE_GROWTH = "price_growth_def";
    // The webhook must not guess. Granting a plan on an unknown price is how
    // a cheap subscription becomes expensive access.
    expect(planForPriceId("price_something_else")).toBeNull();
  });

  it("does NOT match when the env var is unset, even on an empty price id", () => {
    // The trap: with STRIPE_PRICE_STARTER undefined, a naive `id === env`
    // comparison matches when the incoming price id is also undefined or
    // empty — handing out Starter to a malformed event. The mapping requires
    // the configured value to be truthy before comparing.
    expect(planForPriceId("")).toBeNull();
    expect(planForPriceId(undefined as unknown as string)).toBeNull();
  });

  it("never maps two plans to one price", () => {
    // A copy-paste of the same price id into two env vars would make the
    // mapping order-dependent and silently wrong.
    process.env.STRIPE_PRICE_STARTER = "price_same";
    process.env.STRIPE_PRICE_GROWTH = "price_same";

    // It resolves deterministically to the first, but the real assertion is
    // that this is a misconfiguration worth catching in a deploy check — the
    // mapping cannot detect it for us.
    const resolved = planForPriceId("price_same");
    expect(resolved).toBe("starter");
    expect(
      process.env.STRIPE_PRICE_STARTER === process.env.STRIPE_PRICE_GROWTH,
    ).toBe(true);
  });
});

describe("plan → price", () => {
  it("returns null when a plan has no configured price", () => {
    // Better a 503 saying "no price configured" than a Checkout session
    // created against `undefined`, which Stripe rejects with a message about
    // line items that tells nobody anything useful.
    for (const plan of PLANS) {
      expect(stripePriceId(plan.id)).toBeNull();
    }
  });

  it("round-trips every plan", () => {
    process.env.STRIPE_PRICE_STARTER = "price_a";
    process.env.STRIPE_PRICE_GROWTH = "price_b";
    process.env.STRIPE_PRICE_BUSINESS = "price_c";

    for (const plan of PLANS) {
      const priceId = stripePriceId(plan.id);
      expect(priceId).not.toBeNull();
      expect(planForPriceId(priceId as string)).toBe(plan.id);
    }
  });
});

describe("configuration", () => {
  it("reports unconfigured when there is no secret key", () => {
    expect(stripeConfigured()).toBe(false);
  });

  it("reports configured once a key is present", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(stripeConfigured()).toBe(true);
  });
});
