import "../skeleton.css";

/**
 * /inbox — the two-pane mail skeleton, and the fallback for any (dashboard)
 * route that does not ship a closer one.
 *
 * This renders where the page's children render: inside `<main class="pb-main
 * pbm-main">`, which mail.css lays out as a flex ROW. So the skeleton is a
 * fragment of sibling panes, exactly like inbox/page.tsx — a wrapper div would
 * collapse the two panes into one column and shift the whole screen.
 *
 * Every box below carries its real class, so the 336px list width, the 18px
 * card radius, the 13px card padding and the 6px row gap all come from
 * mail.css and cannot drift from the real list.
 *
 * The right-hand pane is deliberately EMPTY. On /inbox the real thread pane is
 * a static "No thread open" message, not data — it is centred in the pane, so
 * it costs no layout shift when it appears, and a shimmering fake of it would
 * only be inventing content that was never loading in the first place.
 */
export default function DashboardLoading() {
  return (
    <>
      <MailListSkeleton />
      <section
        className="pbm-thread pbm-thread--empty"
        data-hide-mobile
        aria-hidden
      />
    </>
  );
}

/**
 * Widths only — every height is inherited from mail.css. Varied on purpose so
 * the pane reads as a stack of messages rather than a table.
 */
const CARDS = [
  { name: 118, time: 30, subject: "88%", preview: "64%", tags: [62, 48] },
  { name: 146, time: 38, subject: "72%", preview: "83%", tags: [54] },
  { name: 96, time: 34, subject: "94%", preview: "58%", tags: [58, 72] },
  { name: 132, time: 30, subject: "66%", preview: "76%", tags: [66] },
  { name: 108, time: 42, subject: "85%", preview: "61%", tags: [50, 44] },
  { name: 152, time: 32, subject: "59%", preview: "80%", tags: [70] },
];

function MailListSkeleton() {
  return (
    <section
      className="pbm-list pbk"
      aria-busy="true"
      aria-label="Loading messages"
    >
      <div className="pbm-list-head" aria-hidden>
        {/* .pbm-search is a fixed 42px box, so nothing inside it can shift. */}
        <div className="pbm-search">
          <span
            className="pbm-search-icon pbk-fill"
            style={{ width: 16, height: 16, borderRadius: 5 }}
          />
          <span
            className="pbm-search-input pbk-text pbk-text--fixed"
            style={{ width: 128 }}
          >
            &nbsp;
          </span>
        </div>

        {/* Real chips: 7px/12px padding around an 11.5px line box. Widths are
            border-box, so these are the finished chip widths. */}
        <div className="pbm-chips">
          {[46, 68, 66, 74, 62, 96].map((w, i) => (
            <span key={i} className="pbm-chip pbk-fill" style={{ width: w }}>
              &nbsp;
            </span>
          ))}
        </div>

        <p className="pbm-list-meta pbk-text" style={{ width: 74 }}>
          &nbsp;
        </p>
      </div>

      <div className="pbm-list-scroll">
        {CARDS.map((c, i) => (
          <div className="pbm-card-wrap" key={i} aria-hidden>
            <div className="pbm-card">
              <div className="pbm-card-top">
                <span className="pbm-card-who">
                  <span className="pbm-dot pbk-fill" />
                  <span
                    className="pbm-card-name pbk-text pbk-text--fixed"
                    style={{ width: c.name }}
                  >
                    &nbsp;
                  </span>
                </span>
                <span
                  className="pbm-card-time pbk-text pbk-text--fixed"
                  style={{ width: c.time }}
                >
                  &nbsp;
                </span>
              </div>
              <div className="pbm-card-subject pbk-text" style={{ width: c.subject }}>
                &nbsp;
              </div>
              <div className="pbm-card-preview pbk-text" style={{ width: c.preview }}>
                &nbsp;
              </div>
              <div className="pbm-card-chips">
                {c.tags.map((w, j) => (
                  <span key={j} className="pbm-tag pbk-fill" style={{ width: w }}>
                    &nbsp;
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
