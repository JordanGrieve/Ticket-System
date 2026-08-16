import Link from "next/link";
import { PostboxLockup } from "@/components/Logo";

/** Shared chrome for the public legal pages. */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
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
          <PostboxLockup size={30} fontSize={18} color="var(--ink)" />
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
