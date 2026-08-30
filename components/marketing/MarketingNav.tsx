import Link from "next/link";
import { PostboxLockup } from "@/components/Logo";

/**
 * The public site's nav bar. ONE definition, used by every marketing page.
 *
 * ── WHY THIS EXISTS ──
 * The homepage and the pricing page had grown two different navs. The homepage
 * had Features, Pricing and Sign in, with a logo that was not a link. The
 * pricing page had Features and Sign in, with a logo that was — so Pricing
 * vanished the moment you were on it, and the only way back to the homepage
 * was a logo that looked identical to the one which did nothing on the page
 * you had just come from. A nav that changes its own contents as you move
 * through a three-page site is a nav people stop trusting to get them
 * anywhere.
 *
 * Two copies of a nav is how that happens, so there is now one.
 *
 * ── THE LOGO ALWAYS LINKS HOME ──
 * Including on the homepage itself, where it goes nowhere new. That is the
 * point: clicking the logo to get home is the one navigation convention
 * everybody already has, and it must not be true on some pages and not others.
 * Nothing on this site should be a link that is sometimes a link.
 *
 * ── LINKS ARE ABSOLUTE, NOT FRAGMENTS ──
 * "Features" is /#features and not #features, so it works from the pricing
 * page as well as from the homepage. A bare fragment silently does nothing on
 * any page that has no such anchor.
 */
export default function MarketingNav({
  current,
}: {
  /** Marks the page you are on, so it is not offered as somewhere to go. */
  current?: "home" | "pricing" | "contact";
}) {
  return (
    <header className="home-nav">
      <Link href="/" aria-label="Postbox home">
        <PostboxLockup />
      </Link>
      <nav className="home-nav-links">
        <Link className="home-nav-link home-nav-link--hide-sm" href="/#features">
          Features
        </Link>
        <Link
          className="home-nav-link home-nav-link--hide-sm"
          href="/pricing"
          // Announced by a screen reader, and styled below, so the current
          // page reads as where you are rather than as somewhere to go.
          aria-current={current === "pricing" ? "page" : undefined}
        >
          Pricing
        </Link>
        <Link
          className="home-nav-link home-nav-link--hide-sm"
          href="/contact"
          aria-current={current === "contact" ? "page" : undefined}
        >
          Contact
        </Link>
        <Link className="home-btn home-btn--sm home-btn--quiet" href="/sign-in">
          Sign in
        </Link>
      </nav>
    </header>
  );
}
