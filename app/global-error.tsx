"use client";

/**
 * Last-resort boundary for errors in the root layout itself. Must render its
 * own <html>/<body> because the layout that normally provides them crashed.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf8f4",
          color: "#26221d",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            postbox
          </div>
          <p style={{ color: "#7a7264", margin: "0 0 20px" }}>
            Something went wrong. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              background: "#d6552f",
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
