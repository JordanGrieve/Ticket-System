"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { THEMES } from "@/lib/theme";

/**
 * The theme picker on Settings → General: Light or Dark.
 *
 * It used to live at the bottom of components/InstallView.tsx under the label
 * "Accent", built from <button aria-pressed>. It is a single-choice control, so
 * it is a radio group here: one tab stop into the group, arrow keys between the
 * cards, and screen readers announce "1 of 2" instead of two unrelated toggles.
 *
 * Persistence: PATCH /api/workspace with { accent } — the column is still named
 * `accent` but stores a theme key (see the route). The chosen theme is applied
 * by the server as a data-theme attribute on the document, so a successful save
 * is followed by router.refresh() to repaint the whole app in the new palette.
 * The local `choice` is optimistic: the card highlights immediately and reverts
 * if the request fails.
 *
 * NOTE: no lib/config import, direct or transitive. This is a client component;
 * lib/config reads non-NEXT_PUBLIC env vars and throws in the browser.
 */
export default function ThemePicker({ value }: { value: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function pick(key: string) {
    if (key === choice) return;
    const previous = choice;
    setChoice(key);
    setError(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accent: key }),
      });
      if (!res.ok) throw new Error("save failed");
      startTransition(() => router.refresh());
    } catch {
      setChoice(previous);
      setError("Couldn't save that theme — please try again.");
    }
  }

  const note = "Light or dark, for everyone in this workspace.";

  return (
    <fieldset className="stg-themes" disabled={pending}>
      <legend className="stg-sr-only">Appearance</legend>
      <p className="stg-section-sub">{note}</p>

      {/*
        Two 44px icon radios — a sun and a moon — where six swatch cards used
        to be. With two choices a card each was "way too big" (Jordan, 9 Sep
        2026); the label text beside the icon keeps the choice legible to
        someone who does not read the glyphs, and it IS the accessible name.
      */}
      <div className="stg-theme-row">
        {THEMES.map((t) => (
          <label className="stg-theme" key={t.key} htmlFor={`theme-${t.key}`}>
            <input
              id={`theme-${t.key}`}
              className="stg-theme-input"
              type="radio"
              name="theme"
              value={t.key}
              checked={choice === t.key}
              onChange={() => pick(t.key)}
            />
            <span className="stg-theme-chip">
              <span className="stg-theme-icon" aria-hidden="true">
                {t.key === "light" ? <SunIcon /> : <MoonIcon />}
              </span>
              <span className="stg-theme-label">{t.label}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="stg-error">{error}</p>}
    </fieldset>
  );
}

/* Feather-style line icons, 20px, stroke from currentColor. Inline rather
   than in components/mail/icons.tsx: nothing else in the product needs a
   sun or a moon, and the mail icon set is for the mail shell. */
function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
