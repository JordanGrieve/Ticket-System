import Link from "next/link";
import type { Metadata } from "next";
import { PostboxLockup } from "@/components/Logo";
import { OPEN_SIGNUP } from "@/lib/config";
import { PLANS, TRIAL_DAYS, TRIAL_LIMITS, formatPrice } from "@/lib/pricing";
import "../home.css";
import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing — Postbox",
  description:
    "What Postbox costs: a shared support inbox and confirmed opt-in newsletters for small businesses.",
};

/**
 * The pricing page.
 *
 * ── THE NUMBERS ARE NOT SIGNED OFF ──
 * Every figure comes from lib/pricing.ts, which says so at length. They are a
 * proposal. This page renders from that module rather than restating anything,
 * so confirming the prices is a one-file edit and cannot leave the page and
 * the enforcement disagreeing.
 *
 * ── NO CHECKOUT YET ──
 * Stripe is not wired up (SELF-SERVE 4). The buttons therefore do not pretend
 * to take money: with sign-up closed they point at sign-in, and with it open
 * they start a trial. A "Buy now" that 404s costs more trust than an honest
 * "start a trial" — and a checkout button that silently does nothing is the
 * single worst thing a pricing page can do.
 *
 * ── WHAT IS DELIBERATELY ABSENT ──
 * No annual toggle: annual pricing has not been decided, and a toggle that
 * flips between two identical numbers is a lie about having thought about it.
 * No "most popular" badge on a product with one pilot client — `featured`
 * highlights a plan visually without claiming other people chose it.
 */
export default function PricingPage() {
  return (
    <div className="home">
      <header className="home-nav">
        <Link href="/">
          <PostboxLockup />
        </Link>
        <nav className="home-nav-links">
          <Link className="home-nav-link home-nav-link--hide-sm" href="/#features">
            Features
          </Link>
          <Link className="home-btn home-btn--sm home-btn--quiet" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>
        <section className="home-section home-wrap prc-head">
          <p className="home-kicker">Pricing</p>
          <h1 className="home-h2 prc-title">
            One price, everything included at that size
          </h1>
          <p className="home-sub prc-sub">
            {OPEN_SIGNUP
              ? `Every plan starts with a ${TRIAL_DAYS}-day free trial — no card needed. Cancel whenever you like; there is no minimum term.`
              : `Every plan starts with a ${TRIAL_DAYS}-day free trial. Postbox is onboarding businesses one at a time at the moment, so get in touch and we will set you up.`}
          </p>
        </section>

        <section className="home-wrap">
          <div className="prc-grid">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={
                  plan.featured ? "prc-card prc-card--featured" : "prc-card"
                }
              >
                <h2 className="prc-name">{plan.name}</h2>
                <p className="prc-tagline">{plan.tagline}</p>

                <p className="prc-price">
                  <span className="prc-amount">{formatPrice(plan.price)}</span>
                  <span className="prc-period">per month</span>
                </p>

                <Link
                  className={
                    plan.featured
                      ? "home-btn home-btn--primary prc-cta"
                      : "home-btn home-btn--quiet prc-cta"
                  }
                  href={OPEN_SIGNUP ? "/sign-up" : "/sign-in"}
                >
                  {OPEN_SIGNUP ? "Start free trial" : "Get in touch"}
                </Link>

                <ul className="prc-features">
                  {plan.features.map((f) => (
                    <li key={f}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/*
                  Stated plainly on the card rather than buried in a footnote.
                  A limit somebody discovers by hitting it is a complaint; a
                  limit they read before paying is a decision they made.
                */}
                <p className="prc-limits">
                  {plan.limits.ticketsPerMonth.toLocaleString()} conversations a
                  month
                  {plan.limits.subscribers > 0
                    ? ` · up to ${plan.limits.subscribers.toLocaleString()} subscribers`
                    : " · newsletters not included"}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="home-section home-wrap">
          <h2 className="home-h2">Questions people ask first</h2>
          <div className="prc-faq">
            {FAQ.map((item) => (
              <div className="prc-faq-item" key={item.q}>
                <h3 className="prc-faq-q">{item.q}</h3>
                <p className="prc-faq-a">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="home-section home-section--last home-wrap">
          <div className="home-band">
            <div>
              <h2 className="home-band-title">Still deciding?</h2>
              <p className="home-band-sub">
                The trial gives you {TRIAL_LIMITS.tickets} conversations and{" "}
                {TRIAL_LIMITS.subscribers} subscribers over {TRIAL_DAYS} days,
                which is enough to connect your form and see it working with
                real customers.
              </p>
            </div>
            <Link
              className="home-btn home-btn--primary"
              href={OPEN_SIGNUP ? "/sign-up" : "/sign-in"}
            >
              {OPEN_SIGNUP ? "Start free trial" : "Get in touch"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <span>© 2026 Postbox · postbox.help</span>
        <span className="home-footer-links">
          <Link href="/">Home</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </span>
      </footer>
    </div>
  );
}

/*
 * Answers only. Every one of these is true of the product as it stands — the
 * trial mechanics described here are the ones being built in SELF-SERVE 3, so
 * this page and that work have to ship together or this becomes fiction.
 */
const FAQ = [
  {
    q: "What happens when the trial ends?",
    a: `The trial runs for ${TRIAL_DAYS} days or ${TRIAL_LIMITS.tickets} conversations, whichever comes first. When it ends you pick a plan. Your messages stay where they are — we do not delete anything because a trial lapsed.`,
  },
  {
    q: "Will you drop my customers' emails if I do not pay?",
    a: "No. Enquiries from your customers keep arriving and keep being recorded whatever your billing state — losing somebody's customer to a billing problem would be unforgivable. Sending newsletters is what stops, because that costs money and it affects you rather than them.",
  },
  {
    q: "Can I change plan later?",
    a: "Yes, up or down, whenever you like. If you move down to a plan with fewer seats you will be asked to remove people first, so nobody is signed out by surprise.",
  },
  {
    q: "Do I need a card to start?",
    a: "No. The trial does not ask for one.",
  },
  {
    q: "Can I send a newsletter to a list I already have?",
    a: "Not by importing it. Everyone on a Postbox list has confirmed their own address by clicking a link we email them. That is the whole basis on which we are allowed to send, and it is why what you send actually arrives.",
  },
];
