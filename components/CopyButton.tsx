"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard, used by the Install tab beside every value a client has
 * to paste elsewhere.
 *
 * Colours are tokens. This button used to sit at `#fff` with `#5f594f` text,
 * which is a cream chip with near-invisible text in five of the six themes —
 * and it is placed on top of the dark code block, where that failure is
 * loudest.
 */
export default function CopyButton({
  value,
  label = "Copy",
  ariaLabel,
  compact = false,
}: {
  value: string;
  label?: string;
  /**
   * A longer accessible name, for a page carrying more than one of these.
   *
   * The install page has two code blocks, so it had two buttons both named
   * "Copy snippet" — indistinguishable to anyone listing the controls instead
   * of looking at them, and ambiguous to voice control.
   *
   * MUST contain `label` word for word (WCAG 2.5.3, Label in Name): the words
   * printed on the button have to keep working as the thing you say.
   */
  ariaLabel?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for older browsers.
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      onClick={copy}
      aria-label={ariaLabel}
      style={{
        height: compact ? 30 : 34,
        padding: compact ? "0 11px" : "0 14px",
        background: copied ? "var(--accent-soft)" : "var(--surface)",
        border: `1px solid ${copied ? "var(--accent-line)" : "var(--border)"}`,
        borderRadius: 8,
        fontSize: "0.78125rem",
        fontWeight: 600,
        color: copied ? "var(--accent-text)" : "var(--text-2)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
