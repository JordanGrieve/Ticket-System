/**
 * The plans, in one place.
 *
 * Pure data and pure functions: no database, no Stripe SDK, no network. The
 * pricing page renders from this, and — once billing exists — the trial and
 * limit checks read the same numbers. Two copies of a plan's limits is how a
 * customer ends up paying for one thing and being allowed another.
 *
 * ── THESE PRICES ARE NOT CONFIRMED ──
 * Jordan chose "three tiers" on 23 August 2026 but has not set the numbers.
 * What follows is a proposal so the page can exist and be argued with. It MUST
 * be signed off before self-serve sign-up opens and before any Stripe price is
 * created — a published price is a promise, and changing it after somebody has
 * paid is a refund conversation rather than an edit.
 *
 * ── LIMITS ARE PROMISES, SO KEEP THEM MODEST ──
 * Subscriber allowances cost real money at SES rates and, more importantly,
 * real sending reputation. Postbox does not have SES production access yet
 * (case 178747420600793, still open), so nothing here should sell a volume the
 * platform cannot currently deliver. The numbers below are deliberately small.
 */

export type PlanId = "starter" | "growth" | "business";

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in whole pounds. */
  price: number;
  /** One line, for the card. Who this is for, not what it contains. */
  tagline: string;
  /** Highlighted card. Exactly one plan may set this. */
  featured: boolean;
  limits: {
    /** People who can sign in to the workspace. */
    seats: number;
    /** Tickets that may be opened per calendar month. */
    ticketsPerMonth: number;
    /**
     * Confirmed subscribers the workspace may hold.
     * 0 means the newsletter side is not included in this plan at all.
     */
    subscribers: number;
  };
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 12,
    tagline: "For a business answering its own email.",
    featured: false,
    limits: { seats: 1, ticketsPerMonth: 500, subscribers: 0 },
    features: [
      "Shared inbox for your contact form and support email",
      "Replies that stay in the same thread",
      "Out-of-hours auto-replies",
      "Contact history on every conversation",
      "1 person",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 29,
    tagline: "For a business with a team and a mailing list.",
    featured: true,
    limits: { seats: 3, ticketsPerMonth: 2000, subscribers: 1000 },
    features: [
      "Everything in Starter",
      "Newsletters with confirmed opt-in",
      "Up to 1,000 subscribers",
      "Signup forms for your website",
      "Up to 3 people",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: 59,
    tagline: "For a busier inbox and a bigger list.",
    featured: false,
    limits: { seats: 10, ticketsPerMonth: 10000, subscribers: 10000 },
    features: [
      "Everything in Growth",
      "Up to 10,000 subscribers",
      "Up to 10 people",
      "Priority support from us",
    ],
  },
];

/** How long a new workspace may use Postbox before choosing a plan. */
export const TRIAL_DAYS = 14;

/**
 * Usage ceilings during the trial, alongside TRIAL_DAYS.
 *
 * The trial ends on whichever runs out first — time or usage. Both exist for
 * different reasons: the clock stops an abandoned workspace costing us Neon
 * compute forever, and the cap stops somebody running a real business on a
 * free trial indefinitely by signing up again each fortnight.
 *
 * Deliberately generous enough to prove the product and too small to live on.
 */
export const TRIAL_LIMITS = {
  tickets: 100,
  subscribers: 100,
} as const;

export function planById(id: PlanId): Plan | null {
  return PLANS.find((p) => p.id === id) ?? null;
}

/**
 * The plan a workspace on this many seats would need.
 *
 * Used when telling somebody why an invite was refused: "Growth allows 3
 * people, Business allows 10" is a more useful sentence than "limit reached".
 * Returns null when no plan is big enough, which is a sales conversation
 * rather than an error.
 */
export function smallestPlanForSeats(seats: number): Plan | null {
  return (
    [...PLANS]
      .sort((a, b) => a.price - b.price)
      .find((p) => p.limits.seats >= seats) ?? null
  );
}

/** Formats a whole-pound monthly price. No currency conversion; GBP only. */
export function formatPrice(price: number): string {
  return `£${price}`;
}
