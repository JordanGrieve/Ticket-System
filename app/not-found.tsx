import Link from "next/link";
import ErrorShell, { ERROR_BUTTON } from "@/components/ErrorShell";

/**
 * Branded 404 — replaces Next.js's default unstyled page.
 *
 * ── IT IS READ BY STRANGERS, NOT ONLY BY AGENTS ──
 * This is the ROOT not-found, so it catches every unmatched URL in the
 * application: the marketing site, the legal pages, a mistyped public link.
 * It used to say "the link may be old, or the ticket it pointed to was
 * deleted" under a button reading "Back to inbox".
 *
 * Both were written for somebody who works here, and neither survives contact
 * with the people who actually arrive. A ticket is internal vocabulary that
 * means nothing to a member of the public; and the button was a lie about its
 * own destination, because "/" is the marketing homepage — a signed-out
 * visitor pressing "Back to inbox" does not reach an inbox.
 *
 * The copy is now true for both audiences at once, which is the only thing a
 * single root 404 can be. Where a route can say something more useful than
 * that, it gets its own — see app/s/not-found.tsx, which renders inside the
 * signup chrome and speaks to somebody holding a broken signup link.
 */
export default function NotFoundPage() {
  return (
    <ErrorShell
      title="This page doesn’t exist"
      body="The link may be out of date, or the page may have been moved."
    >
      <Link href="/" style={ERROR_BUTTON}>
        Go to the homepage
      </Link>
    </ErrorShell>
  );
}
