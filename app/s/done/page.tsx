import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "You're subscribed",
  robots: { index: false, follow: false },
};

/**
 * The end of the signup flow.
 *
 * ── IT SAYS THE SAME THING TO EVERYONE ──
 * Reached after a verified confirmation, whatever the write actually did:
 * newly subscribed, already subscribed, or blocked by a suppression and
 * therefore not subscribed at all. confirmSubscription() reports which, and
 * app/api/subscribe-confirm logs it — but none of it is rendered.
 *
 * The suppression case is the one that matters. Somebody who reported this
 * sender for spam, or who unsubscribed and was then signed up again by
 * someone else, stays blocked; telling them so on this page would confirm to
 * whoever holds that link that the address is known to us and what its
 * standing is. They see this, and they receive nothing, which is what they
 * asked for.
 *
 * Reads nothing, so there is nothing here to leak or to time.
 */
export default function SubscriptionDonePage() {
  return (
    <div className="s-card">
      <h1>
        <span className="s-ok">You&rsquo;re subscribed</span>
      </h1>
      <p>
        That&rsquo;s it &mdash; your address is confirmed and you&rsquo;ll
        receive the newsletter from here on.
      </p>
      <p className="s-fine" style={{ marginBottom: 0 }}>
        Every email includes an unsubscribe link, and it works with one press.
        You can close this tab.
      </p>
    </div>
  );
}
