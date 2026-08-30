import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "This signup link doesn’t work — Postbox",
};

/**
 * A signup link that resolves to nothing.
 *
 * ── WHY THIS ROUTE NEEDS ITS OWN ──
 * app/s/[key] is the only public route that calls notFound(), and until this
 * file existed it fell through to the root 404 — which told the reader "the
 * link may be old, or the ticket it pointed to was deleted" and offered them
 * a button labelled "Back to inbox".
 *
 * Every word of that is addressed to somebody who works here. The person
 * reading THIS page is a stranger: they followed a bakery's link from an
 * Instagram bio, they have no account, no inbox and no idea what a ticket is,
 * and the one thing they were trying to do was hear from a business they like.
 * Being shown internal vocabulary at that moment reads as "this company is
 * broken", and the business whose link it was carries the damage.
 *
 * Living in app/s means it renders inside SubscribeLayout, so it keeps the
 * chrome and the tokens the rest of the signup flow uses rather than the root
 * page's hard-coded palette.
 *
 * ── WHAT IT DOES NOT SAY ──
 * Not "this business does not exist". A key resolves to nothing when it was
 * mistyped, when it was rotated, or when it was never valid, and this page
 * cannot tell those apart — the same reasoning that stops app/u/[token]
 * revealing whether a token was ever real. Naming the wrong cause to somebody
 * who cannot check it just moves the confusion.
 */
export default function SubscribeNotFound() {
  return (
    <div className="s-card">
      <h1>This signup link doesn&rsquo;t work</h1>
      <p>
        The link may have been copied incompletely, or the business may have
        replaced it. Nothing has been signed up and no email address has been
        stored.
      </p>
      <p className="s-fine" style={{ marginBottom: 0 }}>
        If you were trying to hear from a business, the surest fix is to follow
        the link from them again — they can send you a fresh one.
      </p>
    </div>
  );
}
