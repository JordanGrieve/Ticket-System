import "./product-shot.css";

/**
 * The product, shown rather than described — built as DOM, not a screenshot.
 *
 * ── WHY NOT AN ACTUAL SCREENSHOT ──
 * This started as a request for cropped, annotated screenshots, and four
 * things ruled a raster image out. Three are constraints; the fourth is the
 * one that would have bitten us later.
 *
 *  1. SIX THEMES. Only the hero band is guaranteed dark — app/home.css says
 *     so, and everything below it inherits the visitor's theme. A screenshot
 *     is one fixed palette, so a dark amber capture sitting in a section that
 *     renders on a light surface looks wrong in five themes out of six. DOM
 *     reads the same tokens as everything around it and cannot disagree.
 *
 *  2. RESOLUTION. The capture tooling available here is capped at 1x, and a
 *     1x screenshot of a dense inbox is soft on every modern display and
 *     illegible at phone width — which is where most of a small business
 *     owner's browsing happens.
 *
 *  3. CUSTOMER DATA. A screenshot of a real inbox publishes whatever is in it.
 *     db/demo-data.ts exists to move dev addresses onto reserved domains for
 *     exactly this reason; DOM sidesteps the question entirely, because the
 *     names below are written here in the open where anybody can see they are
 *     invented.
 *
 *  4. IT GOES STALE SILENTLY. A screenshot keeps showing the product as it was
 *     the day somebody captured it. Nothing fails, no test goes red, and the
 *     marketing page quietly starts lying about the interface. This replica
 *     drifts too — it is a replica, not the real component — but it is drawn
 *     with the same tokens, so a palette change carries through, and it lives
 *     in the repo where it is edited alongside the thing it depicts.
 *
 * ── IT IS DECORATIVE, AND MARKED AS SUCH ──
 * The whole shot is aria-hidden and every string in it is invented. A screen
 * reader gets the real prose in the section beside it instead of being read a
 * fake inbox. That means nothing here may carry information the page states
 * nowhere else.
 */

export type Annotation = {
  /** What it points at. Kept to a few words — this is a label, not a sentence. */
  text: string;
  /** Percentages of the shot's box, so the callout tracks the thing it names as the shot scales. */
  top: string;
  left: string;
  /** Which side the little connector sits on. */
  from?: "left" | "right";
};

/** One row of the ticket list. All invented; see the note above. */
const ROWS = [
  {
    name: "Priya Raman",
    subject: "Do you cater for gluten-free events?",
    preview: "Hi! I'm organising a team lunch for 25 people on the…",
    tags: ["Contact form", "Sales"],
    when: "8h",
  },
  {
    name: "Tom Whitfield",
    subject: "Invoice 3391 — wrong VAT rate?",
    preview: "Perfect, no rush — I'll hold off paying until I hear…",
    tags: ["Email", "Billing"],
    when: "9h",
  },
  {
    name: "Marcus Bell",
    subject: "ORD-4821 arrived damaged",
    preview: "Order ORD-4821 turned up this morning and two of the…",
    tags: ["Order", "Urgent"],
    when: "9h",
    active: true,
  },
  {
    name: "Daniel Foss",
    subject: "Is the Tuesday class still running?",
    preview: "Thanks for getting in touch — your message has…",
    tags: ["Contact form"],
    when: "12h",
  },
];

const FOLDERS = [
  { label: "All mail", count: 8 },
  { label: "Unread", count: 2 },
  { label: "Awaiting reply", count: 4 },
  { label: "Open", count: 6, active: true },
  { label: "Snoozed", count: 1 },
  { label: "Archived", count: 1 },
];

/**
 * Which part of the app the shot shows.
 *
 * "full" is for the hero and is about RECOGNITION — a visitor should think
 * "oh, it's an email client" without reading anything in it. The cropped
 * variants are for the feature sections and are about MEANING: one idea per
 * image, scaled up so the UI text inside stays legible instead of shrinking to
 * an unreadable 8px when the whole app is squeezed into half a column.
 *
 * That split is the single most consistent thing across the product pages
 * worth copying — one full shot for shape, single-idea crops for everything
 * that has to be understood.
 */
export type ShotFocus = "full" | "inbox" | "thread";

export default function ProductShot({
  annotations = [],
  focus = "full",
  className = "",
}: {
  annotations?: Annotation[];
  focus?: ShotFocus;
  className?: string;
}) {
  return (
    <div className={`pshot-frame ${className}`.trim()} data-focus={focus}>
      {/*
        A window bar rather than full browser chrome with a fake URL. A drawn
        address bar invites the reader to check whether the URL is real, and
        ours would not be — this is not a photograph of a page that exists at
        an address. Three dots say "application window" and claim nothing.
      */}
      <div className="pshot-bar" aria-hidden>
        <span className="pshot-dot" />
        <span className="pshot-dot" />
        <span className="pshot-dot" />
      </div>

      <div className="pshot-body" aria-hidden data-focus={focus}>
        <aside className="pshot-side">
          <div className="pshot-brand">
            <span className="pshot-brand-mark" />
            <span className="pshot-brand-name">Open Door Bakery</span>
          </div>
          <ul className="pshot-folders">
            {FOLDERS.map((f) => (
              <li
                key={f.label}
                className="pshot-folder"
                data-active={f.active || undefined}
              >
                <span className="pshot-folder-label">{f.label}</span>
                <span className="pshot-folder-count">{f.count}</span>
              </li>
            ))}
          </ul>
        </aside>

        <div className="pshot-list">
          {ROWS.map((r) => (
            <article
              key={r.name}
              className="pshot-row"
              data-active={r.active || undefined}
            >
              <div className="pshot-row-top">
                <span className="pshot-row-name">{r.name}</span>
                <span className="pshot-row-when">{r.when}</span>
              </div>
              <p className="pshot-row-subject">{r.subject}</p>
              <p className="pshot-row-preview">{r.preview}</p>
              <div className="pshot-row-tags">
                {r.tags.map((t) => (
                  <span className="pshot-tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="pshot-thread">
          <div className="pshot-thread-head">
            <span className="pshot-thread-name">Marcus Bell</span>
            <span className="pshot-thread-sub">ORD-4821 arrived damaged</span>
          </div>

          <div className="pshot-bubbles">
            <div className="pshot-bubble">
              Order ORD-4821 turned up this morning and two of the large boxes
              were crushed. Is it too late to swap them?
            </div>
            <p className="pshot-meta">Yesterday, 8:55 am · via order form</p>

            <div className="pshot-bubble pshot-bubble--out">
              Caught it just in time — the order hadn&rsquo;t gone to packing
              yet. I&rsquo;ve put two fresh boxes on it.
            </div>
            {/*
              "Delivered" is the one label in this shot doing real work: it is
              the claim the product can now back, and the reason the delivery
              webhook was built. It is styled to be read, not skimmed past.
            */}
            <p className="pshot-meta pshot-meta--ok">
              Yesterday, 9:55 am · Delivered
            </p>
          </div>
        </div>
      </div>

      {/*
        Callouts sit OUTSIDE the aria-hidden body so their text is still read,
        and are positioned in percentages so they follow what they point at as
        the shot scales. They are hidden below the mobile breakpoint, where the
        shot is cropped to the thread and there is no room for them — the
        section's own prose carries the same points.
      */}
      {annotations.map((a) => (
        <span
          key={a.text}
          className="pshot-note"
          style={{ top: a.top, left: a.left }}
          data-from={a.from ?? "left"}
        >
          {a.text}
        </span>
      ))}
    </div>
  );
}
