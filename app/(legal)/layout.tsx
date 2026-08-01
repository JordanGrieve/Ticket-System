import Link from "next/link";
import { accentVars } from "@/lib/theme";

/** Shared chrome for the public legal pages. */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        ...accentVars("terracotta"),
        minHeight: "100vh",
        background: "var(--app-bg)",
        color: "var(--ink)",
      }}
    >
      <header
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "22px 24px 0",
        }}
      >
        <Link
          href="/"
          style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--accent)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 16,
            }}
            aria-hidden
          >
            p
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
            postbox
          </span>
        </Link>
      </header>
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "28px 24px 72px",
          fontSize: 14.5,
          lineHeight: 1.7,
        }}
      >
        {children}
      </main>
    </div>
  );
}
