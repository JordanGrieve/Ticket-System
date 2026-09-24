"use client";

import { useState, type ReactNode } from "react";

/**
 * A row of mode toggles and the panel for whichever one is on.
 *
 * The only state on the Install page besides a code block's Show more, so it
 * is the only other part that ships to the browser. InstallView (a server
 * component) renders every panel up front and hands them in; this chooses
 * which to show. Each section has its own instance, so a client who has
 * already wired up one form does not have the other switch tab under them.
 */
export default function InstallModes({
  options,
  initial,
  panels,
}: {
  options: {
    value: string;
    /** The words on the button. */
    text: string;
    /** The accessible name. Must contain `text` — see Toggle. */
    label: string;
  }[];
  initial: string;
  panels: Record<string, ReactNode>;
}) {
  const [mode, setMode] = useState(initial);
  return (
    <>
      <div className="sti-modes">
        {options.map((o) => (
          <Toggle
            key={o.value}
            active={mode === o.value}
            onClick={() => setMode(o.value)}
            label={o.label}
          >
            {o.text}
          </Toggle>
        ))}
      </div>
      {panels[mode]}
    </>
  );
}

/**
 * One mode toggle.
 *
 * ── WHY IT TAKES A LABEL ──
 *
 * This page has two sections offering the same two choices, so before 14 Sep
 * 2026 it rendered two buttons reading "✨ AI prompt (recommended)" and two
 * reading "No code". Sighted people tell them apart by the heading above each;
 * anyone listing the page's controls — a screen reader's control list, voice
 * control saying "click AI prompt" — got two identical names and no way to
 * choose.
 *
 * `label` is the accessible name and always NAMES THE SECTION. It must contain
 * the visible text word for word: WCAG 2.5.3 Label in Name, so that saying what
 * is written on the button still activates it. "AI prompt for your contact
 * form" contains "AI prompt"; "AI prompt · contact" would not.
 */
function Toggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** The accessible name. Must contain the visible text — see above. */
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      className="sti-mode"
      data-on={active}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
