"use client";

/**
 * Branded error boundary — without this, a server hiccup shows clients
 * Next.js's raw white error screen.
 */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#faf8f4",
        color: "#26221d",
        padding: 24,
        fontFamily: "var(--font-hanken), system-ui, sans-serif",
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
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "#d6552f",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            p
          </div>
          <span style={{ fontSize: 20, fontWeight: 700 }}>postbox</span>
        </div>
        <h1 style={{ fontSize: 21, fontWeight: 700, marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#7a7264", margin: "0 0 22px" }}>
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
              background: "#d6552f",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              background: "#fff",
              color: "#5f594f",
              fontSize: 13.5,
              fontWeight: 600,
              border: "1px solid #e7e1d7",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Back to inbox
          </a>
        </div>
      </div>
    </div>
  );
}
