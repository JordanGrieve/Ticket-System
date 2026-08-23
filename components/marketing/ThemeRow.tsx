import "./theme-row.css";

/**
 * The five palettes, side by side.
 *
 * ── WHY THIS IS A FEATURE SECTION AND NOT A PROBLEM ──
 * Postbox ships several themes, which for a marketing page is usually an
 * awkward fact: it means no single screenshot is what the reader will actually
 * see. Showing the palettes deliberately turns that into the point — the
 * product looks like whatever the person using it all day wants it to look
 * like, which for a shared inbox somebody sits in front of from six in the
 * morning is a real thing to sell rather than a caveat to hide.
 *
 * ── FIVE, NOT SIX ──
 * The picker offers six options and lib/theme.ts calls them six themes, but
 * one of them is "System", which is not a palette — it is the absence of a
 * choice, resolving to Light or Dark from the device. So there are five
 * palettes to show, and this says five. Drawing a sixth swatch would mean
 * inventing one.
 *
 * ── EACH SWATCH SCOPES ITS OWN THEME ──
 * The data-theme attribute is set per swatch and the custom properties cascade
 * into it, so five palettes render on one page with no duplicated CSS and no
 * hardcoded colours here. Light needed globals.css to name
 * [data-theme="light"] beside :root — see the note there.
 */

const SWATCHES: { theme: string; label: string }[] = [
  { theme: "light", label: "Light" },
  { theme: "dark", label: "Dark" },
  { theme: "forest", label: "Forest" },
  { theme: "slate", label: "Slate" },
  { theme: "ocean", label: "Ocean" },
];

export default function ThemeRow() {
  return (
    <ul className="pthemes">
      {SWATCHES.map((s) => (
        <li className="pthemes-item" key={s.theme}>
          {/*
            aria-hidden for the same reason as the product shot: it is a
            picture of an interface, and a screen reader should get the
            section's prose rather than a fake thread read out five times.
            The label below it is real text and stays readable.
          */}
          <div className="pthemes-swatch" data-theme={s.theme} aria-hidden>
            <span className="pthemes-side" />
            <span className="pthemes-pane">
              <span className="pthemes-bubble" />
              <span className="pthemes-bubble pthemes-bubble--out" />
              <span className="pthemes-bubble pthemes-bubble--short" />
            </span>
          </div>
          <p className="pthemes-label">{s.label}</p>
        </li>
      ))}
    </ul>
  );
}
