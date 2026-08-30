import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Unsubscribed",
  robots: { index: false, follow: false },
};

/**
 * Shown after the POST that actually unsubscribed.
 *
 * Reached only by the 303 redirect from POST /u/[token]?web=1, which is what
 * keeps a browser refresh from re-posting. Like the confirmation page it reads
 * nothing and names nobody.
 *
 * ── WHAT IT PROMISES ──
 * Only things that are true. The block is recorded before this page renders
 * (the redirect happens after the write, and a failed write returns 500
 * instead), so "you've been unsubscribed" is not optimism. The caveat about
 * mail already in flight is real: a campaign that has already handed a message
 * to the provider cannot be recalled.
 *
 * It does not claim to stop support email, because it does not: suppressions
 * gate marketing sends, and replies to a ticket the reader opened are a
 * different system. Saying otherwise would be the kind of plausible-sounding
 * lie that turns into a complaint when the next reply arrives.
 */
export default function UnsubscribedPage() {
  return (
    <div className="u-card">
      <h1>
        <span className="u-ok">You&rsquo;re unsubscribed.</span>
      </h1>
      <p>
        We&rsquo;ve recorded it. You won&rsquo;t receive marketing email from
        this sender again, and re-importing your address won&rsquo;t undo it.
      </p>
      <p>
        Anything already handed to the mail provider may still arrive &mdash;
        that can take a little while to clear.
      </p>
      <p className="u-fine" style={{ marginBottom: 0 }}>
        Replies to any support conversation you started are separate and are
        not affected.
      </p>
    </div>
  );
}
