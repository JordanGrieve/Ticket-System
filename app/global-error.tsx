"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { PostboxLockup, LITERAL_COLORS } from "@/components/Logo";

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
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e1a33",
          color: "#f3f0ff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          {/* Literal colours: this boundary replaces the root layout, so
              globals.css never loaded and the accent tokens don't resolve. */}
          <div style={{ marginBottom: 8 }}>
            <PostboxLockup colors={LITERAL_COLORS} />
          </div>
          <p style={{ color: "#8a84a4", margin: "0 0 20px" }}>
            Something went wrong. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              background: "#6d4aff",
              color: "#fff",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
