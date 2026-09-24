"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import ErrorShell, { ERROR_BUTTON } from "@/components/ErrorShell";

/**
 * Last-resort boundary for errors in the root layout itself. Must render its
 * own <html>/<body> because the layout that normally provides them crashed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <ErrorShell title="Something went wrong" body="Please try again.">
          <button onClick={() => reset()} style={ERROR_BUTTON}>
            Try again
          </button>
        </ErrorShell>
      </body>
    </html>
  );
}
