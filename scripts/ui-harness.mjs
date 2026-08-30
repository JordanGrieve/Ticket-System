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
 * ── THE TRAP: A CASE MUST CARRY THE COMPONENT'S REAL ANCESTRY ──
 * This bit me within an hour of writing it. The sidebar plan card was rendered
 * without its `.pbm` wrapper, which is where --pbm-on-dark is defined. An
 * undefined var() makes the WHOLE declaration invalid at computed-value time,
 * so `box-shadow: 0 8px 18px var(--pro-shadow), inset 0 0 0 2px
 * var(--pbm-on-dark)` resolved to `none` — and the harness reported that the
 * urgent card had lost its shadow entirely.
 *
 * It had not. The real card lives inside `<div className="pb-shell pbm">` and
 * resolves fine. The bug was in the CASE, and I nearly "fixed" working code
 * because of it.
 *
 * So: give every case the ancestor classes that carry its tokens, and when
 * this harness reports a failure, confirm it against the real markup before
 * changing anything. A verification tool trusted blindly is worse than none.
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
  {
    /*
     * The two diagnostic tables in the operator console. Both render
     * `.pba-row`, which app/admin.css declares as display:grid with NO
     * grid-template-columns — a grid with no template is ONE column, so these
     * were stacking every cell vertically. Fixed by reasoning about the CSS
     * and shipped unverified, because the console needs an admin login. This
     * case is what actually checks it.
     *
     * The console is always dark (.pba-root carries data-theme="dark"), so the
     * question here is layout rather than palette.
     */
    name: "Admin — diagnostic tables (were stacking as one column)",
    css: ["app/admin.css", "app/(admin)/admin/console.css"],
    wrap: (inner) => `<div class="pba-root" data-theme="dark" style="padding:14px">${inner}</div>`,
    html: `
<div class="pba-card">
  <div class="pba-table"><div class="pba-scroll">
    <div class="pba-row pba-row-head"><span>Reason</span><span>Event</span><span>Count</span><span>Last seen</span><span>Example message</span></div>
    <div class="pba-row pba-row-diag" data-destructive><span>Unmatched message id</span><span>Bounce</span><span>12</span><span>30 Aug 2026</span><span class="pba-mono">0100018f2a…</span></div>
    <div class="pba-row pba-row-diag"><span>No message id</span><span>Complaint</span><span>3</span><span>29 Aug 2026</span><span class="pba-mono">—</span></div>
  </div></div>
</div>`,
  },
  {
    name: "Admin — chain verification, intact and broken",
    css: ["app/admin.css", "app/(admin)/admin/console.css"],
    wrap: (inner) => `<div class="pba-root" data-theme="dark" style="padding:14px">${inner}</div>`,
    html: `
<div class="pba-card">
  <p class="pba-chain" data-state="ok"><b>Chain intact</b> 9 chained sessions verify against each other (unkeyed: this detects accidents and careless edits, not a deliberate rewrite). 4 older rows predate the chain and cannot be verified either way.</p>
  <p class="pba-chain" data-state="broken"><b>CHAIN BROKEN — a row has been deleted or edited</b> 3 of 9 verified, then: Session #14 points at a row that is not the row before it. At least one session between it and the previous row has been deleted.</p>
</div>`,
  },
  {
    /* The sidebar billing card, rewritten from a dead hard-coded button. It
       renders inside the TENANT dashboard, so unlike the console it really
       does have to survive all six palettes. */
    name: "Sidebar — plan card (urgent and normal)",
    css: ["app/mail.css"],
    // MUST carry .pbm. That class is where --pbm-on-dark is defined, and the
    // real dashboard shell is <div className="pb-shell pbm">. Rendering the
    // card without it left the token undefined — see the note at the top.
    wrap: (inner) => `<div class="pbm" style="padding:14px;max-width:280px">${inner}</div>`,
    html: `
<aside class="pbm-pro"><p class="pbm-pro-title">Free trial</p><p class="pbm-pro-body">9 days left. Your inbox keeps working either way.</p><a class="pbm-pro-btn" href="#">See plans</a></aside>
<div style="height:12px"></div>
<aside class="pbm-pro" data-urgent><p class="pbm-pro-title">Trial ended</p><p class="pbm-pro-body">Choose a plan to send newsletters again. Your inbox is unaffected.</p><a class="pbm-pro-btn" href="#">Choose a plan</a></aside>`,
  },
];

const panel = (theme, c) => `
  <figure class="panel">
    <figcaption>${theme ?? "system default"}</figcaption>
    <div class="stage"${theme ? ` data-theme="${theme}"` : ""}>${c.wrap ? c.wrap(c.html) : c.html}</div>
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
