"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { THEMES } from "@/lib/theme";

/**
 * The six-theme picker from the design's Settings → General screen.
 *
 * It used to live at the bottom of components/InstallView.tsx under the label
 * "Accent", built from <button aria-pressed>. It is a single-choice control, so
 * it is a radio group here: one tab stop into the group, arrow keys between the
 * cards, and screen readers announce "3 of 6" instead of six unrelated toggles.
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

  const note =
    choice === "system"
      ? "Postbox follows your operating system appearance."
      : "Appearance is set manually for this workspace.";

  return (
    <fieldset className="stg-themes" disabled={pending}>
      <legend className="stg-sr-only">Appearance</legend>
      <p className="stg-section-sub">{note}</p>

      <div className="stg-theme-grid">
        {THEMES.map((t) => (
          <label className="stg-theme" key={t.key}>
            <input
              className="stg-theme-input"
              type="radio"
              name="theme"
              value={t.key}
              checked={choice === t.key}
              onChange={() => pick(t.key)}
            />
            <span className="stg-theme-card">
              {/*
                The ONE place in this feature that names colours literally: a
                swatch has to show the theme it offers, not the theme currently
                applied, so it cannot read --surface/--accent. Values are copied
                from the corresponding palette block in app/globals.css —
                surface → accent for each theme; "system" is split light/dark.
                Keep these in step if those palettes ever move.
              */}
              <span
                className="stg-theme-swatch"
                style={{ background: SWATCH[t.key] }}
                aria-hidden="true"
              />
              <span className="stg-theme-foot">
                <span className="stg-theme-text">
                  <span className="stg-theme-label">{t.label}</span>
                  <span className="stg-theme-note">{t.note}</span>
                </span>
                <span className="stg-theme-check" aria-hidden="true">
                  ✓
                </span>
              </span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="stg-error">{error}</p>}
    </fieldset>
  );
}

/**
 * Swatch gradients, one per theme key. Literal hex on purpose — see the comment
 * at the usage site. Sourced from app/globals.css:
 *   light  --surface #fff over --accent-soft #ede7fe
 *   dark   --surface #241f3c → --accent-grad top stop #8b6bff
 *   forest --surface #17251f → #49c98c
 *   slate  --surface #232322 → #d9a05b
 *   ocean  --surface #182741 → #5b9bff
 *   system light and dark grounds, split down the diagonal
 */
const SWATCH: Record<string, string> = {
  system: "linear-gradient(135deg, #ede7fe 0 50%, #241f3c 50% 100%)",
  light: "linear-gradient(140deg, #ede7fe, #ffffff 70%)",
  dark: "linear-gradient(140deg, #241f3c, #8b6bff)",
  forest: "linear-gradient(140deg, #17251f, #49c98c)",
  slate: "linear-gradient(140deg, #232322, #d9a05b)",
  ocean: "linear-gradient(140deg, #182741, #5b9bff)",
};
