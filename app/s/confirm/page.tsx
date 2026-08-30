import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Confirm your subscription",
  // The URL carries a signed token. It must never reach an index.
  robots: { index: false, follow: false },
};

/**
 * The page the confirmation link opens.
 *
 * ── IT READS NOTHING ──
 * No database query and no token decode. The token is passed straight through
 * into the form, and it is app/api/subscribe-confirm that verifies it. So a
 * guessed or expired token renders exactly this page, and the URL cannot be
 * used to test whether an address is pending on somebody's list. Same reasoning
 * as app/u/[token]/confirm/page.tsx, which reads nothing for the same reason.
 *
 * The sending workspace is deliberately not named. We could decode the token
 * to get it, and it would read better — but a link that arrives in unencrypted
 * mail, gets forwarded and sits in shared inboxes should not be a lookup for
 * who is signing up to what.
 *
 * ── THE BUTTON IS THE MECHANISM ──
 * Landing here does not subscribe anyone; pressing does. Mail scanners and
 * link-preview bots fetch every URL in a message, so a GET that subscribed
 * would mean the scanner consented on the recipient's behalf — which destroys
 * the only thing double opt-in exists to produce. A plain HTML form, no
 * JavaScript, so it also works in a text browser and with scripting off.
 */
export default async function ConfirmSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; e?: string }>;
}) {
  const { t, e } = await searchParams;

  // One page for malformed, forged and expired alike. Telling a prober which
  // of the three they hit tells them which half of the guess was right.
  if (e === "1" || !t) {
    return (
      <div className="s-card">
        <h1>This link didn&rsquo;t work</h1>
        <p>
          Confirmation links expire, and they can be broken by a mail client
          that wraps long lines. Nothing has been changed.
        </p>
        <p className="s-fine" style={{ marginBottom: 0 }}>
          Sign up again to get a fresh link. If you didn&rsquo;t sign up, you
          can ignore this &mdash; you are not on the list.
        </p>
      </div>
    );
  }

  return (
    <div className="s-card">
      <h1>Confirm your subscription</h1>
      <p>
        Press the button to confirm you want to receive these emails. This is
        the last step.
      </p>
      <form method="post" action="/api/subscribe-confirm">
        <input type="hidden" name="t" value={t} />
        <button className="s-button" type="submit">
          Yes, subscribe me
        </button>
      </form>
      <p className="s-fine" style={{ marginTop: 18, marginBottom: 0 }}>
        Nothing happens until you press it &mdash; if you opened this by
        accident, just close the tab.
      </p>
    </div>
  );
}
