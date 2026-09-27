"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard, used by the Install tab beside every value a client has
 * to paste elsewhere.
 *
 * Colours are tokens. This button used to sit at `#fff` with `#5f594f` text,
 * which is a cream chip with near-invisible text in the dark theme —
 * and it is placed on top of the dark code block, where that failure is
 * loudest.
 *
 * The drawing lives in `.pb-copy` (app/globals.css), not in a style object.
 * It was inline until 27 Sep 2026, which is exactly why the two "Copy address"
 * buttons had no hover state: a style attribute cannot express `:hover`, so
 * the missing state was not an oversight anyone could fix by changing a value.
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
      className={`pb-copy${compact ? " pb-copy--compact" : ""}`}
      data-copied={copied || undefined}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
