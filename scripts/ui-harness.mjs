import { readFileSync, writeFileSync } from "node:fs";

/**
 * Render login-gated UI across all six themes, from the REAL stylesheets.
 *
 * ── WHY THIS EXISTS ──
 * Most of this product is behind an authentication wall. The dashboard, the
 * settings screens and the operator console cannot be opened in a preview
 * browser without signing in as somebody, so every change to them has shipped
 * with the same caveat attached: "not verified visually". That caveat has been
 * on a lot of commits.
 *
 * It matters most for exactly the class of change it is hardest to reason
 * about: CSS that has to hold up under six palettes, three of which are dark.
 * The two bugs this repo has already had there — an InstallView that rendered
 * cream cards on dark grounds in five themes, and two admin tables that were
 * grids with no columns — were both invisible to types, lint and tests, and
 * both were found by a person looking.
 *
 * ── WHAT IT DOES AND DOES NOT PROVE ──
 * It imports the actual stylesheets, so what you see is what those rules do.
 * The MARKUP is written here by hand to match the component, which is the
 * honest limitation: it proves the CSS, not that the component still emits
 * that markup. Pair it with a test that pins the class names when that matters.
 *
 * It cannot check behaviour, focus order or anything requiring React. For a
 * confirmation panel — is it readable, does the destructive option look
 * destructive, does it fit — that is the whole question.
 *
 * ── USAGE ──
 *   node scripts/ui-harness.mjs
 * writes public/_harness.html (gitignored), which the dev server serves at
 * /_harness.html. Delete it when finished; it is throwaway.
 */

const globals = readFileSync("app/globals.css", "utf8");

/** The six palettes. `null` is whatever the OS asks for. */
const THEMES = [null, "light", "dark", "forest", "slate", "ocean"];

/**
 * One thing to look at: a name, the stylesheets it needs, and its markup.
 *
 * Stylesheets are listed per case rather than all loaded at once, so a case
 * cannot accidentally be rescued by a rule from a screen it does not share.
 */
const CASES = [
  {
    name: "InstallView — rotate key confirmation",
    css: ["app/settings.css"],
    // Mirrors components/InstallView.tsx. The classes are what is under test.
    html: `
<div class="sti-wrap"><div class="sti-col">
  <div class="sti-section">
    <div class="sti-label">Workspace API key</div>
    <div class="sti-field"><div class="sti-field-value sti-field-value--mono">cli_9f2a7c4e1b</div></div>
    <div class="sti-gap"></div>
    <div class="sti-confirm" role="alertdialog" aria-label="Rotate the API key">
      <p class="sti-confirm-q">Rotate the API key? The current key stops working <b>immediately</b> — every form on your site using it will fail until you paste the new snippet in. There is no undo.</p>
      <div class="sti-confirm-acts">
        <button type="button" class="sti-confirm-btn">Cancel</button>
        <button type="button" class="sti-confirm-btn sti-confirm-btn--danger">Rotate the key</button>
      </div>
    </div>
    <p class="sti-rotate-error">Couldn&rsquo;t rotate the key — nothing has changed, so your forms are still working. Try again in a moment.</p>
  </div>
</div></div>`,
  },
  {
    name: "Composer — remove queued recipients",
    css: ["app/newsletter.css"],
    html: `
<div style="padding:16px">
  <div class="nl-confirm" role="alertdialog" aria-label="Remove queued recipients">
    <p class="nl-confirm-q">Remove 47 queued recipient rows? The rows are deleted; you can queue the list again afterwards.</p>
    <div class="nl-confirm-acts">
      <button type="button" class="nl-confirm-btn">Keep them</button>
      <button type="button" class="nl-confirm-btn nl-confirm-btn--danger">Remove</button>
    </div>
  </div>
</div>`,
  },
];

const panel = (theme, c) => `
  <figure class="panel">
    <figcaption>${theme ?? "system default"}</figcaption>
    <div class="stage"${theme ? ` data-theme="${theme}"` : ""}>${c.html}</div>
  </figure>`;

const section = (c) => `
<section>
  <h2>${c.name}</h2>
  <style>${c.css.map((f) => readFileSync(f, "utf8")).join("\n")}</style>
  <div class="grid">${THEMES.map((t) => panel(t, c)).join("")}</div>
</section>`;

writeFileSync(
  "public/_harness.html",
  `<!doctype html><html><head><meta charset="utf-8"><title>UI harness</title>
<style>${globals}</style>
<style>
  body { margin:0; padding:24px; background:#0b0a12; font:13px system-ui; }
  h2 { color:#e9e5ff; font-size:14px; margin:24px 0 10px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:16px; }
  figure { margin:0; }
  figcaption { color:#8e88a8; font-size:11px; margin-bottom:6px; text-transform:uppercase; letter-spacing:.05em; }
  /* The stage carries the theme attribute, so the tokens inside resolve exactly
     as they would on a real page with that theme selected. */
  .stage { border:1px solid #2b2549; border-radius:12px; overflow:hidden; background:var(--app-bg); }
</style></head><body>
${CASES.map(section).join("")}
</body></html>`,
);

console.log(`wrote public/_harness.html — ${CASES.length} case(s) x ${THEMES.length} themes`);
