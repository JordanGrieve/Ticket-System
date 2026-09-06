import { readFileSync, writeFileSync } from "node:fs";

/**
 * The mobile screens, at a real phone width, from the REAL stylesheets.
 *
 * Sibling of scripts/ui-harness.mjs and built for a different question. That
 * one renders small panels across six palettes to check COLOUR. This one
 * renders one 375px column to check LAYOUT — whether a strip scrolls, whether
 * a grid wraps, whether a row of controls fits — which the six-up grid cannot
 * show because every panel is too narrow to be a phone and too wide to be
 * wrong in the same way.
 *
 * THE TRAP, HIT AGAIN ON THE FIRST RUN. A case must carry the component's real
 * ancestry or it does not reproduce the bug. The settings tab strip was probed
 * here as a bare .pbs-tabs and reported scrollWidth > clientWidth, i.e. "it
 * scrolls fine" — while on the real page it could not scroll at all, because
 * app/mail.css had `.pbm-page > * { overflow: visible !important }` and the
 * strip is a direct child of .pbm-page.
 *
 * So the strip is wrapped in .pbm-page here, exactly as settings/layout.tsx
 * does. A harness that says a broken thing works is worse than no harness.
 *
 * Usage:  node scripts/mobile-harness.mjs   → public/_mobile.html (gitignored)
 */

const css = (f) => readFileSync(f, "utf8");

const ICONS = JSON.parse(
  JSON.stringify(
    Object.fromEntries(
      [...readFileSync("components/mail/icons.tsx", "utf8").matchAll(
        /^\s{2}([a-zA-Z]+):\s*\n?\s*"([^"]+)",/gm,
      )].map((m) => [m[1], m[2]]),
    ),
  ),
);

const icon = (name, size = 21) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] ?? ""}"/></svg>`;

const TABS = [
  ["mail", "Open", true],
  ["lines", "Awaiting", false],
  ["news", "All", false],
  ["star", "Starred", false],
  ["settings", "Settings", false],
];

const SWATCH = {
  system: "linear-gradient(135deg,#ede7fe 0 50%,#241f3c 50% 100%)",
  light: "linear-gradient(135deg,#ffffff,#ede7fe)",
  dark: "linear-gradient(135deg,#241f3c,#8b6bff)",
  forest: "linear-gradient(135deg,#17251f,#49c98c)",
  slate: "linear-gradient(135deg,#232322,#d9a05b)",
  ocean: "linear-gradient(135deg,#111d33,#4f8df5)",
};
const THEMES = [
  ["system", "System", "Match my device"],
  ["light", "Light", "Warm violet"],
  ["dark", "Dark", "Low light"],
  ["forest", "Forest", "Deep green"],
  ["slate", "Slate", "Warm grey"],
  ["ocean", "Ocean", "Cool blue"],
];

const themeCard = ([key, label, note], checked) => `
<label class="stg-theme">
  <input class="stg-theme-input" type="radio" name="theme" value="${key}"${checked ? " checked" : ""}>
  <span class="stg-theme-card">
    <span class="stg-theme-swatch" style="background:${SWATCH[key]}" aria-hidden="true"></span>
    <span class="stg-theme-foot">
      <span class="stg-theme-text">
        <span class="stg-theme-label">${label}</span>
        <span class="stg-theme-note">${note}</span>
      </span>
      <span class="stg-theme-check" aria-hidden="true">&#10003;</span>
    </span>
  </span>
</label>`;

const swatches = (sel) => `
<span class="pbm-swatches">
  ${["tag_a", "tag_b", "tag_c"]
    .map(
      (c, i) =>
        `<button type="button" class="pbm-label-swatch pbm-label-swatch--pick" data-color="${c}"${i === sel ? ' data-on="true"' : ""} aria-label="colour ${i + 1}"></button>`,
    )
    .join("")}
  <button type="button" class="pbm-label-pick" aria-label="Custom colour"></button>
</span>`;

const labelRow = (name, sel) => `
<div class="pbm-label-row">
  <span class="pbm-label" data-color="tag_${"abc"[sel] ?? "a"}"><span class="pbm-label-name">${name}</span></span>
  <span class="pbm-label-count">1 ticket</span>
  ${swatches(sel)}
  <button type="button" class="pbm-label-icon" aria-label="Rename">${icon("pencil", 15)}</button>
  <button type="button" class="pbm-label-icon pbm-label-icon--danger" aria-label="Delete">${icon("trash", 15)}</button>
</div>`;

const card = ({ name, time, subject, preview, src, labels = [], unread, awaiting, order }) => `
<div class="pbm-card-wrap">
  <a class="pbm-card" href="#"${unread ? " data-unread" : ""}>
    <div class="pbm-card-top">
      <span class="pbm-card-who">${unread ? '<span class="pbm-dot" aria-hidden=""></span>' : ""}<span class="pbm-card-name">${name}</span></span>
      <span class="pbm-card-time">${time}</span>
    </div>
    <div class="pbm-card-subject">${subject}</div>
    <div class="pbm-card-preview">${preview}</div>
    <div class="pbm-card-chips">
      <span class="pbm-tag">${src}</span>
      ${labels.map((l, i) => `<span class="pbm-label pbm-label--sm" data-color="tag_${"abc"[i % 3]}"><span class="pbm-label-name">${l}</span></span>`).join("")}
      ${awaiting ? '<span class="pbm-tag pbm-tag--awaiting">Awaiting</span>' : ""}
      ${order ? `<span class="pbm-tag pbm-tag--order">${order}</span>` : ""}
    </div>
  </a>
  <button class="pbm-card-star" aria-label="Star">${icon("star", 15)}</button>
</div>`;

const SECTIONS = [
  {
    id: "icons",
    title: "1 · Mobile tab icons, drawn large",
    body: `
<div class="probe-icons">
  ${TABS.map(([n, l]) => `<figure><div class="probe-icon">${icon(n, 72)}</div><figcaption>${l}<br><code>${n}</code></figcaption></figure>`).join("")}
</div>
<p class="probe-note">Every icon on one baseline at 72px. A glyph that is wrong at 21px is usually obviously wrong here.</p>`,
  },
  {
    id: "tabbar",
    title: "2 · The bottom tab bar, as it ships",
    body: `<nav class="pbm-tabs" aria-label="Sections">
  ${TABS.map(([n, l, on]) => `<a class="pbm-tab" href="#"${on ? ' data-on="true"' : ""}>${icon(n)}<span>${l}</span></a>`).join("")}
</nav>`,
  },
  {
    id: "tabs",
    title: "3 · Settings tab strip (does it scroll?)",
    // .pbm-page wrapper is load-bearing — see the note at the top of this file.
    body: `<div class="pbm-page" style="max-height:120px"><nav class="pbs-tabs" aria-label="Settings sections">
  ${["General", "Auto-reply", "Contacts", "Labels", "Forms", "Team", "Billing", "Install"]
    .map((t, i) => `<a class="pbs-tab" href="#"${i === 0 ? ' data-active="true"' : ""}>${t}</a>`)
    .join("")}
</nav></div>
<p class="probe-note">Wrapped in .pbm-page, as the real settings layout does.</p>`,
  },
  {
    id: "appearance",
    title: "4 · Appearance grid",
    body: `<div class="stg-section">
  <h2 class="stg-section-title">Appearance</h2>
  <fieldset class="stg-themes">
    <p class="stg-section-sub">Postbox follows your operating system appearance.</p>
    <div class="stg-theme-grid">${THEMES.map((t, i) => themeCard(t, i === 0)).join("")}</div>
  </fieldset>
</div>`,
  },
  {
    id: "labels",
    title: "5 · Labels, inline in Settings",
    body: `<div class="pbm-modal pbm-modal--inline">
  <div class="pbm-modal-body">
    ${labelRow("fsdf", 0)}
    ${labelRow("green", 1)}
    ${labelRow("red", 2)}
    <div class="pbm-label-row pbm-label-row--new">
      <input class="pbm-label-input" placeholder="New label…">
      ${swatches(0)}
      <button type="button" class="pbm-label-create">+ Add</button>
    </div>
  </div>
</div>`,
  },
  {
    id: "inbox",
    title: "6 · Inbox list card",
    /*
      Wrapped in .pbm-list > .pbm-list-scroll, which is where the mobile
      padding, gap and card shadow come from. A bare .pbm-card renders on the
      wrong ground and at the wrong width.
    */
    body: `<div class="pbm-list"><div class="pbm-list-scroll pb-scroll">
  ${card({ name: "Priya Raman", time: "8h", subject: "Do you cater for gluten-free events?", preview: "Hello — we have a staff lunch coming up in March and two people are coeliac. Is that something you can do?", src: "Contact form", labels: ["Sales"], unread: true })}
  ${card({ name: "Tom Whitfield", time: "9h", subject: "Invoice 3391 — wrong VAT rate?", preview: "I think the VAT on this one is 20% but it should be zero-rated for the cakes.", src: "Email", labels: ["Billing", "Wholesale"], awaiting: true, order: "ORD-4821" })}
  ${card({ name: "A Customer With A Very Long Name Indeed", time: "12h", subject: "A subject line that is quite a lot longer than the card is wide and must not break the layout", preview: "Short.", src: "Contact form", labels: [] })}
</div></div>`,
  },
  {
    id: "thread",
    title: "7 · Thread",
    body: `<div class="pbm-thread">
  <header class="pbm-thread-head">
    <a class="pbm-icon-btn pbm-back" href="#" aria-label="Back to the list">${icon("back", 17)}</a>
    <div class="pbm-thread-who">
      <p class="pbm-thread-name">Priya Raman</p>
      <p class="pbm-thread-email">priya.raman@example.com</p>
    </div>
    <div class="pbm-thread-actions">
      <button class="pbm-icon-btn" aria-label="Mark as unread">${icon("envelopeOpen", 17)}</button>
      <button class="pbm-icon-btn" aria-label="Snooze">${icon("clock", 17)}</button>
      <button class="pbm-icon-btn" aria-label="Archive">${icon("archive", 17)}</button>
      <button class="pbm-icon-btn" aria-label="Find in Gmail">${icon("clip", 17)}</button>
      <button class="pbm-icon-btn" aria-label="Delete">${icon("trash", 17)}</button>
    </div>
  </header>
  <div class="pbm-subject">
    <div class="pbm-thread-subject">Do you cater for gluten-free events?</div>
    <div class="pbm-subject-chips">
      <span class="pbm-chip-static pbm-chip-static--src">Contact form</span>
      <span class="pbm-chip-static">Open</span>
    </div>
  </div>
  <div class="pbm-transcript pb-scroll">
    <div class="pbm-bubble-row"><div class="pbm-bubble-wrap">
      <div class="pbm-bubble">Hello — we have a staff lunch coming up in March and two people are coeliac. Is that something you can do, and would it need to be a separate order?</div>
      <div class="pbm-bubble-foot">Yesterday, 8:55 am</div>
    </div></div>
    <div class="pbm-bubble-row" data-out><div class="pbm-bubble-wrap">
      <div class="pbm-bubble">Yes — we do a gluten-free range and can keep it on a separate tray so there is no cross-contamination. I will send the list over.</div>
      <div class="pbm-bubble-foot">Yesterday, 9:55 am · Delivered</div>
    </div></div>
  </div>
  <div class="pbm-composer-wrap">
    <div class="pbm-composer">
      <textarea class="pbm-composer-input" rows="1" placeholder="Write a reply…"></textarea>
      <button class="pbm-send" aria-label="Send">${icon("send", 17)}</button>
    </div>
    <div class="pbm-composer-foot">Sends as Open Door Bakery &lt;replies@postbox.help&gt;</div>
  </div>
</div>`,
  },
];

writeFileSync(
  "public/_mobile.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mobile harness</title>
<style>${css("app/globals.css")}</style>
<style>${css("app/mail.css")}</style>
<style>${css("app/settings.css")}</style>
<style>
  .probe-col { display:block; }
  body { margin:0; background:var(--app-bg); font:14px system-ui; color:var(--text); }
  .probe-h { font:700 12px system-ui; text-transform:uppercase; letter-spacing:.06em;
             color:var(--muted); padding:18px 16px 8px; }
  .probe-box { background:var(--surface); border:1px solid var(--border); border-radius:14px;
               margin:0 12px 10px; padding:12px; overflow:hidden; }
  .probe-note { font-size:11.5px; color:var(--muted); margin:8px 2px 0; }
  .probe-icons { display:flex; gap:14px; flex-wrap:wrap; }
  .probe-icons figure { margin:0; text-align:center; color:var(--text); }
  .probe-icon { border:1px dashed var(--border-strong); border-radius:10px; padding:6px;
                display:grid; place-items:center; }
  .probe-icons figcaption { font-size:10.5px; color:var(--muted); margin-top:4px; }
  /* The tab bar is position:fixed in the app; pinned here so it sits in flow. */
  #tabbar .pbm-tabs { position:static; }
</style>
</head><body class="pbm"><div class="pbm probe-col">
${SECTIONS.map((s) => `<h2 class="probe-h">${s.title}</h2><section id="${s.id}" class="probe-box">${s.body}</section>`).join("\n")}
</div></body></html>`,
);

console.log("wrote public/_mobile.html —", SECTIONS.length, "sections");
