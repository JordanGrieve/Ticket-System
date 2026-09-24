import type { CSSProperties, ReactNode } from "react";
import { PostboxLockup, LITERAL_COLORS } from "@/components/Logo";

/**
 * The page behind the error boundary, the global error boundary and the root
 * 404.
 *
 * Every colour is a literal, because global-error replaces the root layout and
 * renders with no stylesheet at all; the other two share it so the three look
 * the same. Each literal clears AAA on the ground it is painted on: heading
 * 14.97:1, body 8.70:1, white on the accent 7.11:1, the quiet button's ink
 * 16.33:1.
 */
export const ERROR_BUTTON: CSSProperties = {
  minHeight: 44,
  padding: "0 20px",
  borderRadius: 10,
  background: "#583cce",
  color: "#fff",
  fontSize: "0.84375rem",
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};

export const ERROR_BUTTON_QUIET: CSSProperties = {
  ...ERROR_BUTTON,
  background: "#fff",
  color: "#221b3a",
};

export default function ErrorShell({
  title,
  body,
  children,
}: {
  title: string;
  body: ReactNode;
  children: ReactNode;
}) {
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
        <h1 style={{ fontSize: "1.3125rem", fontWeight: 700, margin: "0 0 8px" }}>
          {title}
        </h1>
        <p style={{ fontSize: "0.90625rem", lineHeight: 1.65, color: "#bdb7d4", margin: "0 0 22px" }}>
          {body}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
