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
        className="legal-prose"
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "28px 24px 72px",
          fontSize: 14.5,
          lineHeight: 1.7,
        }}
      >
        {/*
          Paragraph spacing lives here rather than on each <p>. The reset
          zeroes block margins, which never showed while every section was a
          heading plus one paragraph — the h2 margin carried the rhythm. These
          pages now run several paragraphs per section, so without this they
          set as one wall of text. Scoped to the legal pages only.
        */}
        <style>{`
          .legal-prose p { margin: 0 0 12px; }
          .legal-prose p:last-child { margin-bottom: 0; }
          /* The reset strips list markers. These lists are enumerations of
             obligations and prohibitions, so the bullets carry meaning. */
          .legal-prose ul { margin: 0 0 12px; padding-left: 22px; list-style: disc; }
          .legal-prose ol { margin: 0 0 12px; padding-left: 22px; list-style: decimal; }
          .legal-prose li { margin-bottom: 6px; }
          .legal-prose li::marker { color: var(--muted); }
          .legal-prose code {
            font-family: var(--font-mono);
            font-size: 0.92em;
            overflow-wrap: anywhere;
          }
        `}</style>
        {children}
      </main>
    </div>
  );
}
