import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { PostboxLockup } from "@/components/Logo";
import { OPEN_SIGNUP } from "@/lib/config";
import ProductShot from "@/components/marketing/ProductShot";
import ThemeRow from "@/components/marketing/ThemeRow";
import FeatureBento from "@/components/marketing/FeatureBento";
import "./home.css";

/**
 * The public marketing page. Signed-in visitors go straight to their inbox.
 *
 * ── THE CTA TELLS THE TRUTH ABOUT THE PRODUCT'S STATE ──
 * Self-serve sign-up is gated behind OPEN_SIGNUP (lib/workspace.ts: with it
 * off, a stranger who completes Clerk sign-up is handed no workspace and lands
 * on /no-access). So a "Start free trial" button while that flag is false is a
 * promise the product does not keep — somebody creates an account, sees a dead
 * end, and never comes back.
 *
 * The hero therefore reads the flag. With sign-up open it sells the trial;
 * with it closed it asks for an enquiry instead, which is the truth today.
 * When the flag is flipped this page changes with it, rather than needing
 * somebody to remember to come back and edit the copy.
 *
 * ── EVERY CLAIM HERE MUST BE TRUE ──
 * No invented testimonials, no customer logos, no "trusted by hundreds of
 * businesses". There is one pilot client. A marketing page for a product whose
 * pitch is trustworthy email cannot itself be the least trustworthy page we
 * ship.
 *
 * ── #newsletters IS LOAD-BEARING ──
 * It was added so an AWS reviewer assessing the SES production-access request
 * could see the newsletter half of the product described. That case is still
 * open. Do not remove or weaken that section.
 */
export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/inbox");

  return (
    <div className="home">
      <header className="home-nav">
        <PostboxLockup />
        <nav className="home-nav-links">
          <Link
            className="home-nav-link home-nav-link--hide-sm"
            href="#features"
          >
            Features
          </Link>
          <Link className="home-nav-link home-nav-link--hide-sm" href="/pricing">
            Pricing
          </Link>
          <Link className="home-btn home-btn--sm home-btn--quiet" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>
        <section className="home-hero">
          <div className="home-hero-inner">
            <p className="home-eyebrow">Support inbox + newsletters</p>

            <h1 className="home-h1">
              Every customer email in <em>one shared inbox</em>
            </h1>

            <p className="home-lede">
              Postbox turns your website&rsquo;s contact form and your support
              email into a single inbox your whole team can answer from — and
              sends your newsletter from the same place, to people who actually
              asked for it.
            </p>

            <div className="home-cta-row">
              {OPEN_SIGNUP ? (
                <>
                  <Link className="home-btn home-btn--primary" href="/sign-up">
                    Start free trial
                  </Link>
                  <Link className="home-btn home-btn--ghost" href="/pricing">
                    See pricing
                  </Link>
                </>
              ) : (
                <>
                  <Link className="home-btn home-btn--primary" href="/pricing">
                    See pricing
                  </Link>
                  <Link className="home-btn home-btn--ghost" href="/sign-in">
                    Sign in
                  </Link>
                </>
              )}
            </div>

            <p className="home-cta-note">
              {OPEN_SIGNUP
                ? "No card needed to start."
                : "Postbox is onboarding businesses one at a time — ask your provider for access."}
            </p>
          </div>

          {/*
            The product, shown. This page described Postbox in words and never
            once showed it, which asks a bakery owner to imagine software.

            NO ANNOTATIONS HERE, deliberately. The hero's job is recognition —
            a visitor should think "oh, it's like an email client" in about
            half a second, without reading anything inside it. Callouts here
            would compete with the headline and the button, which are the two
            things this section actually needs somebody to read. The feature
            sections below carry the labelled, single-idea crops.
          */}
          <div className="home-shot">
            <ProductShot />
          </div>
        </section>

        {/*
          THE THREE LOAD-BEARING FEATURES, SHOWN.

          The grid above states eight things in words. These two sections take
          the two that matter most and put the product next to the claim,
          because a bakery owner deciding whether to move their customer email
          into an unfamiliar tool is being asked to imagine software, and the
          page gave them nothing to look at.

          Alternating sides, one idea per image, and at most two callouts each.
          Three is the documented ceiling before a screenshot stops being a
          picture of a product and becomes a diagram — and the ceiling is
          lower here than it looks, because these crops are narrow.
        */}
        <section
          className="home-showcase home-section--after-shot home-wrap"
          id="features"
        >
          <div className="home-show">
            <div className="home-show-copy">
              <p className="home-kicker">The inbox</p>
              <h2 className="home-show-title">
                Your contact form and your email, in one list
              </h2>
              <p className="home-show-body">
                Everything a customer sends you arrives in the same place, in
                the order it arrived, with a label saying where it came from.
                No forwarding rules to maintain, and nothing sitting unread in
                a mailbox only one person can open.
              </p>
              <p className="home-show-body">
                Whoever is free answers. The whole team sees the same threads,
                so nobody sends a second reply to a customer who has already
                been helped.
              </p>
            </div>
            <div className="home-show-shot">
              <ProductShot
                focus="inbox"
                annotations={[
                  {
                    /*
                     * Measured against the "Order" chip, not guessed. The
                     * first version of this sat at 62%/-2% and its connector
                     * landed 150px away from any UI at all — a callout
                     * pointing at blank space, which is worse than no callout
                     * because the reader hunts for what it means.
                     */
                    text: "Where it came from",
                    top: "71.6%",
                    left: "60.9%",
                    from: "right",
                  },
                  {
                    text: "One list, every channel",
                    top: "13%",
                    left: "82%",
                    from: "right",
                  },
                ]}
              />
            </div>
          </div>

          <div className="home-show home-show--flip">
            <div className="home-show-copy">
              <p className="home-kicker">Replies</p>
              <h2 className="home-show-title">
                You can see that it actually arrived
              </h2>
              <p className="home-show-body">
                Answer from Postbox and it reaches the customer as an ordinary
                email from your business. When they write back it returns to the
                same thread instead of starting a new one nobody connects to the
                last.
              </p>
              <p className="home-show-body">
                Every reply says what happened to it. If a message bounced, the
                thread tells you — rather than you finding out because the
                customer chased you.
              </p>
            </div>
            <div className="home-show-shot">
              <ProductShot
                focus="thread"
                annotations={[
                  {
                    text: "Confirmed by the mail provider",
                    top: "84%",
                    left: "76%",
                    from: "right",
                  },
                ]}
              />
            </div>
          </div>

          {/*
            The newsletter half, which the page previously described in four
            text cards and never showed.

            The shot is the composer beside its live preview, and the preview
            is the point: it is rendered by the same function the send path
            calls, so the unsubscribe link and the postal address in it are the
            real ones. "We handle compliance" is a promise; a visible footer is
            evidence — and it is the specific evidence both a cautious owner
            and an AWS reviewer are looking for.
          */}
          <div className="home-show">
            <div className="home-show-copy">
              <p className="home-kicker">Newsletters</p>
              <h2 className="home-show-title">
                The same customers, without the spreadsheet
              </h2>
              <p className="home-show-body">
                People subscribe from a form on your own site and confirm their
                own address by email, so you keep a record that they asked for
                it. Nobody is added by hand, and somebody who only ever emailed
                support is not a subscriber.
              </p>
              <p className="home-show-body">
                Every campaign carries a one-click unsubscribe and your postal
                address, because that is what the law asks for and what mail
                providers look for before they deliver you.
              </p>
            </div>
            <div className="home-show-shot">
              <ProductShot
                focus="newsletter"
                annotations={[
                  {
                    text: "One-click unsubscribe, always",
                    top: "70%",
                    left: "30%",
                    from: "left",
                  },
                ]}
              />
            </div>
          </div>
        </section>

        {/*
          The rest of the product, at a glance.

          A grid rather than more alternating sections, because these answer a
          different question. The showcases are a sequence — mail arrives, you
          answer it, you send a newsletter. This is a set, scanned in any order
          by somebody looking for the one thing that matters to them.

          Nothing here repeats the showcases above. Saying the same thing twice
          in two different shapes reads as padding.
        */}
        <section className="home-section home-wrap">
          <p className="home-kicker">What else it does</p>
          <h2 className="home-h2">The small things that decide whether you keep using it</h2>
          <p className="home-sub">
            None of these are why anybody signs up. They are why nobody goes
            back to a shared Gmail account three weeks later.
          </p>
          <FeatureBento />
        </section>

        {/*
          The palettes.

          Several themes is normally an awkward fact for a marketing page,
          because it means no single image is what the reader will actually
          see. Showing them makes that the point instead: a shared inbox is
          something somebody sits in front of from six in the morning, and
          "it looks how you want it to look" is worth selling rather than
          hiding.

          Five, not six. The picker offers six but one is "System", which is
          not a palette — it is the absence of a choice. Drawing a sixth
          swatch would mean inventing one.
        */}
        <section className="home-section home-wrap">
          <p className="home-kicker">Make it yours</p>
          <h2 className="home-h2">Five looks, one inbox</h2>
          <p className="home-sub">
            Pick the one you can stand to look at all day. It is a per-person
            setting, so nobody has to agree with anybody else about it.
          </p>
          <ThemeRow />
        </section>

        {/*
          Kept from the previous page, restyled only. See the note at the top:
          the SES production-access case is still open and a reviewer may read
          this section to judge how subscribers are collected.
        */}
        <section className="home-section home-wrap" id="newsletters">
          <p className="home-kicker">Newsletters</p>
          <h2 className="home-h2">Newsletters, sent properly</h2>
          <p className="home-sub">
            The same workspace sends your newsletter. People subscribe from a
            form on your own site, and every part of the process is built so you
            can show, later, that they asked for it.
          </p>

          <div className="home-grid">
            {NEWSLETTER_POINTS.map((f) => (
              <div className="home-card" key={f.title}>
                <h3 className="home-card-title">{f.title}</h3>
                <p className="home-card-body">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="home-section home-section--last home-wrap">
          <div className="home-band">
            <div>
              <h2 className="home-band-title">
                {OPEN_SIGNUP
                  ? "Start with a free trial"
                  : "Want Postbox for your business?"}
              </h2>
              <p className="home-band-sub">
                {OPEN_SIGNUP
                  ? "Connect your contact form in a couple of minutes. No card needed to start, and you can leave whenever you like."
                  : "We are onboarding businesses one at a time so that every one gets set up properly. Have a look at the pricing and get in touch."}
              </p>
            </div>
            <Link
              className="home-btn home-btn--primary"
              href={OPEN_SIGNUP ? "/sign-up" : "/pricing"}
            >
              {OPEN_SIGNUP ? "Start free trial" : "See pricing"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <span>© 2026 Postbox · postbox.help</span>
        <span className="home-footer-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </span>
      </footer>
    </div>
  );
}

/*
 * The four newsletter compliance points, kept as text.
 *
 * The FEATURES array and the inline glyph helper that fed it were deleted
 * when the showcases and the bento took over. Two of its four cards are now
 * shown properly with product imagery, and the other two moved into the
 * grid; leaving the array behind would have meant the page describing the
 * same features twice in two different shapes.
 *
 * These four stay prose on purpose. They are claims about PROCESS -- what is
 * recorded, what is refused, what happens to a bounce -- and there is no
 * screen that shows a consent record being kept. Drawing one would be
 * inventing an interface to illustrate a policy. See the note at the top of
 * this file: an AWS reviewer may read this section while the SES case is
 * open, and it is load-bearing exactly as written.
 */
const NEWSLETTER_POINTS = [
  {
    title: "Confirmed opt-in only",
    body: "Someone enters their address, we email them a confirmation link, and nothing is stored until they press it. No purchased lists, no imported addresses, no way to add a subscriber who never clicked.",
  },
  {
    title: "A record of every consent",
    body: "For each subscriber we keep how they subscribed, the moment they confirmed, the page the form was on, and the IP the confirmation came from. An address with no consent record is excluded from every send.",
  },
  {
    title: "One-click unsubscribe",
    body: "Every newsletter carries a one-click unsubscribe header and a visible link. No login, no account, no questions — and the address is suppressed immediately, for good.",
  },
  {
    title: "Bounces and complaints act on themselves",
    body: "Hard bounces and spam complaints are fed straight back into a suppression list, so an address that failed or objected is never sent to again. Your postal address appears in every message, as the law requires.",
  },
];
