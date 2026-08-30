import { readFileSync, writeFileSync } from "node:fs";

/**
 * Render the impersonation pill on its own, from the REAL stylesheet.
 *
 * The pill only appears while a Postbox operator is inside a client workspace,
 * which needs an admin login — so it cannot be reached in the preview browser.
 * This harness pulls in app/(admin)/impersonation-banner.css verbatim (not a
 * copy, not an approximation) and paints the same markup the component emits,
 * so what is on screen is what the CSS actually does.
 *
 * Throwaway: writes to public/ so the dev server can serve it, and the file is
 * deleted straight after. Nothing imports this at build time.
 */
const css = readFileSync("app/(admin)/impersonation-banner.css", "utf8");

const pill = (name, unlogged, open) => `
<div class="pbi-banner" data-unlogged="${unlogged}" role="status">
  <details class="pbi-disclosure"${open ? " open" : ""}>
    <summary class="pbi-summary">
      <span class="pbi-stripe"></span>
      <span class="pbi-name">${name}</span>
      ${unlogged === "true" ? '<span class="pbi-alarm">not recorded</span>' : ""}
      <span class="pbi-chev"></span>
    </summary>
    <div class="pbi-panel">
      <p class="pbi-panel-lead">You are inside <b>${name}</b> as a Postbox operator. This is a client&rsquo;s live customer data.</p>
      <p class="pbi-meta">${
        unlogged === "true"
          ? "jordangrieve.dev@gmail.com · <b>this visit is NOT being recorded</b> — there is no open access-log entry for it. Stop, then re-enter from the admin console so the access is logged."
          : "jordangrieve.dev@gmail.com · started 30 Aug 2026, 12:22 · no reason was given · access #9 is recorded in the access log"
      }</p>
    </div>
  </details>
  <form><button type="button" class="pbi-stop">Stop</button></form>
</div>`;

// A stand-in for the inbox behind it, so overlap is visible rather than assumed.
const behind = `
<div class="fake-app">
  <div class="fake-search">Search this page…</div>
  <div class="fake-chip">All</div>
  <div class="fake-count">7 tickets</div>
  ${["Priya Raman", "Tom Whitfield", "Marcus Bell"]
    .map(
      (n) => `<div class="fake-card"><b>${n}</b><div>Do you cater for gluten-free events?</div></div>`,
    )
    .join("")}
</div>`;

const scene = (label, width, inner) => `
<section class="case">
  <h2>${label} — ${width}px</h2>
  <div class="frame" style="width:${width}px">${inner}</div>
</section>`;

writeFileSync(
  "public/_pill.html",
  `<!doctype html><html><head><meta charset="utf-8"><style>
${css}
body { margin:0; background:#0f0d1a; color:#8e88a8; font:13px system-ui; padding:20px; }
h2 { color:#cfc8e6; font-size:13px; margin:22px 0 8px; }
.frame { position:relative; height:340px; overflow:hidden; border:1px solid #2b2549; border-radius:14px; background:#1e1a33; }
/* The pill is position:fixed; inside a harness we want it pinned to the FRAME,
   so the frame becomes the containing block via a transform. */
.frame { transform: translateZ(0); }
.fake-app { padding:14px; }
.fake-search { background:#241f3c; border-radius:10px; padding:9px 12px; color:#6d6a7c; margin-bottom:12px; }
.fake-chip { display:inline-block; background:#6d4aff; color:#fff; border-radius:999px; padding:4px 14px; font-weight:700; }
.fake-count { margin:10px 0; font-size:11px; }
.fake-card { background:#241f3c; border-radius:12px; padding:11px 13px; margin-bottom:8px; color:#cfc8e6; }
.fake-card div { color:#8c86a5; font-size:11px; margin-top:3px; }
</style></head><body>
${scene("Collapsed, phone", 390, behind + pill("DevBusiness", "false", false))}
${scene("Expanded, phone", 390, behind + pill("DevBusiness", "false", true))}
${scene("Not recorded, phone", 390, behind + pill("DevBusiness", "true", false))}
${scene("Collapsed, desktop", 900, behind + pill("Open Door Bakery", "false", false))}
${scene("Very long name, phone", 390, behind + pill("The Extremely Long Bakery And Coffee Company Limited", "false", false))}
</body></html>`,
);
console.log("wrote public/_pill.html");
