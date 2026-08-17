import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Unsubscribe — Postbox",
  // A URL containing a per-recipient secret must never reach an index.
  robots: { index: false, follow: false },
};

/**
 * The page a human lands on after clicking the unsubscribe link.
 *
 * ── IT READS NOTHING ──
 * No database query, and therefore nothing to leak: the recipient's address,
 * the sending workspace and the campaign are all absent from this page. Two
 * consequences, both wanted. A guessed token renders exactly this page, so the
 * URL cannot be used to test whether an address is on somebody's list; and the
 * page cannot be timed into an oracle either, because there is nothing to time.
 *
 * The cost is that we cannot show "you are unsubscribing bob@x.com from
 * Acme" — which is friendlier, and which every hosted ESP does. It is not
 * worth turning a URL that arrives in unencrypted mail, gets forwarded, and
 * sits in shared inboxes into a lookup for who subscribes to what.
 *
 * ── THE FORM IS THE WHOLE MECHANISM ──
 * A plain HTML form POSTing to /u/[token]?web=1 — no JavaScript, no client
 * component, no fetch. It works in a text browser, in a locked-down corporate
 * mail client, and with scripting disabled, which is the population that most
 * often needs this page to work. `?web=1` is what tells the route handler to
 * answer with a redirect to the confirmation page instead of the one-line text
 * body that mail providers get.
 */
export default async function ConfirmUnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="u-card">
      <h1>Unsubscribe from these emails?</h1>
      <p>
        Press the button and you&rsquo;ll stop receiving marketing email from
        the sender who sent you this link.
      </p>
      <form method="post" action={`/u/${encodeURIComponent(token)}?web=1`}>
        <button className="u-button" type="submit">
          Unsubscribe me
        </button>
      </form>
      <p className="u-fine" style={{ marginTop: 18, marginBottom: 0 }}>
        This link is unique to you. Nothing happens until you press the button
        &mdash; if you opened it by accident, just close the tab.
      </p>
    </div>
  );
}
