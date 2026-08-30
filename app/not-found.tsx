import Link from "next/link";
import { PostboxLockup, LITERAL_COLORS } from "@/components/Logo";

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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1e1a33",
        color: "#f3f0ff",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 24,
          }}
        >
          <PostboxLockup colors={LITERAL_COLORS} />
        </div>
        <h1 style={{ fontSize: 21, fontWeight: 700, marginBottom: 8 }}>
          This page doesn&rsquo;t exist
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#8a84a4", margin: "0 0 22px" }}>
          The link may be out of date, or the page may have been moved.
        </p>
        <Link
          href="/"
          style={{
            height: 40,
            padding: "0 20px",
            borderRadius: 10,
            background: "#6d4aff",
            color: "#fff",
            fontSize: 13.5,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Go to the homepage
        </Link>
      </div>
    </div>
  );
}
