import Link from "next/link";

/** Branded 404 — replaces Next.js's default unstyled page. */
export default function NotFoundPage() {
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
          This page doesn&rsquo;t exist
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#7a7264", margin: "0 0 22px" }}>
          The link may be old, or the ticket it pointed to was deleted.
        </p>
        <Link
          href="/"
          style={{
            height: 40,
            padding: "0 20px",
            borderRadius: 10,
            background: "#d6552f",
            color: "#fff",
            fontSize: 13.5,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Back to inbox
        </Link>
      </div>
    </div>
  );
}
