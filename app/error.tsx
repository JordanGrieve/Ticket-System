"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { PostboxLockup, LITERAL_COLORS } from "@/components/Logo";

/**
 * Branded error boundary — without this, a server hiccup shows clients
 * Next.js's raw white error screen.
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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1e1a33",
        color: "#f3f0ff",
        padding: 24,
        fontFamily: "var(--font-jakarta), system-ui, sans-serif",
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
        <h1 style={{ fontSize: "1.3125rem", fontWeight: 700, marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "0.90625rem", lineHeight: 1.65, color: "#bdb7d4", margin: "0 0 22px" }}>
          Sorry — that didn&rsquo;t work. It&rsquo;s been noted on our side;
          trying again usually fixes it.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={() => reset()}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              /* The AAA accent (7.11:1 under white) — a literal, as this page
                 must render even when the stylesheets did not. */
              background: "#583cce",
              color: "#fff",
              fontSize: "0.84375rem",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              background: "#fff",
              color: "#5f594f",
              fontSize: "0.84375rem",
              fontWeight: 600,
              border: "1px solid #e7e1d7",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Back to inbox
          </Link>
        </div>
      </div>
    </div>
  );
}
