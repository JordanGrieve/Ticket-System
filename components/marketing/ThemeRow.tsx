"use client";

import { useState } from "react";
import "./theme-row.css";

/**
 * The five palettes, side by side — and clicking one repaints the page.
 *
 * ── WHY THEY ARE BUTTONS ──
 * They were swatches: five little pictures of an interface, each carrying its
 * own data-theme so it rendered in its own palette. They looked clickable
 * because a row of coloured tiles under "Pick the one you can stand to look at
 * all day" is an invitation, and pressing one did nothing at all.
 *
 * A swatch is also a poor way to judge a palette. Ninety square pixels of
 * colour tells you very little about what a whole screen of it feels like,
 * which is the actual question somebody is asking here. Pressing one now sets
 * data-theme on the document, so every section of the page — the product
 * shots, the bento cells, the body text — repaints in it. That is the closest
 * this page can get to the thing being sold.
 *
 * ── IT CHANGES THE PAGE, NOT THE ACCOUNT ──
 * Nothing is saved and nothing is sent anywhere. A visitor has no workspace to
 * store a preference on, and quietly writing one would be a setting they never
 * asked for. Reloading returns the page to whatever their device implies,
 * which is also the honest default for somebody who has not signed up.
 *
 * ── FIVE, NOT SIX ──
 * The picker in the app offers six and lib/theme.ts calls them six themes, but
 * one is "System", which is not a palette — it is the absence of a choice,
 * resolving to Light or Dark from the device. There are five palettes to show.
 */

const SWATCHES: { theme: string; label: string }[] = [
  { theme: "light", label: "Light" },
  { theme: "dark", label: "Dark" },
  { theme: "forest", label: "Forest" },
  { theme: "slate", label: "Slate" },
  { theme: "ocean", label: "Ocean" },
];

export default function ThemeRow() {
  /**
   * Null means "whatever the visitor arrived with" — no data-theme attribute,
   * so globals.css falls back to prefers-color-scheme. It is deliberately not
   * seeded to "dark": guessing wrong would show a pressed state for a palette
   * the page is not actually rendering.
   */
  const [picked, setPicked] = useState<string | null>(null);

  function apply(theme: string) {
    const root = document.documentElement;
    /*
     * Read the ATTRIBUTE, not the React state.
     *
     * `picked` comes from a closure, so two clicks in quick succession can
     * both see the pre-first-click value and the second one does nothing —
     * caught by clicking the same swatch twice in a row and watching the
     * theme fail to clear. The document is the real source of truth here,
     * because the document is what the theme is actually set on.
     */
    if (root.getAttribute("data-theme") === theme) {
      // Pressing the current one again gives the visitor their own setting
      // back, so trying the palettes is not a one-way door.
      root.removeAttribute("data-theme");
      setPicked(null);
      return;
    }
    root.setAttribute("data-theme", theme);
    setPicked(theme);
  }

  return (
    <ul className="pthemes">
      {SWATCHES.map((s) => (
        <li className="pthemes-item" key={s.theme}>
          <button
            type="button"
            className="pthemes-swatch"
            data-theme={s.theme}
            data-picked={picked === s.theme || undefined}
            onClick={() => apply(s.theme)}
            /* The label below is the accessible name; the tiles are a picture
               of an interface and would otherwise be read as nothing. */
            aria-label={`Preview the ${s.label} theme on this page`}
            aria-pressed={picked === s.theme}
          >
            <span className="pthemes-side" aria-hidden />
            <span className="pthemes-pane" aria-hidden>
              <span className="pthemes-bubble" />
              <span className="pthemes-bubble pthemes-bubble--out" />
              <span className="pthemes-bubble pthemes-bubble--short" />
            </span>
          </button>
          <p className="pthemes-label">{s.label}</p>
        </li>
      ))}
    </ul>
  );
}
