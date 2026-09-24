"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import ErrorShell, { ERROR_BUTTON, ERROR_BUTTON_QUIET } from "@/components/ErrorShell";

/**
 * Branded error boundary — without this, a server hiccup shows clients
 * Next.js's raw white error screen.
 *
 * The second button goes to "/", the marketing homepage, and says so: this
 * boundary also catches errors on public pages, where "Back to inbox" would
 * send a signed-out visitor somewhere they cannot go (see app/not-found.tsx).
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Makes the "it's been noted on our side" copy below actually true.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <ErrorShell
      title="Something went wrong"
      body={
        <>
          Sorry — that didn&rsquo;t work. It&rsquo;s been noted on our side;
          trying again usually fixes it.
        </>
      }
    >
      <button onClick={() => reset()} style={ERROR_BUTTON}>
        Try again
      </button>
      <Link href="/" style={ERROR_BUTTON_QUIET}>
        Go to the homepage
      </Link>
    </ErrorShell>
  );
}
