import "../../../skeleton.css";

/**
 * /tickets/[id] — list pane + conversation + contact rail.
 *
 * Mirrors what the route actually renders (MessageList, Thread, and the
 * ContactRail that Thread always mounts), because on desktop all three are
 * columns of the same flex row and leaving one out would move the other two.
 *
 * Three details that are easy to get wrong here:
 *
 *  · the list pane carries `data-hide-mobile`, exactly as the real page does
 *    (`<MessageList … hideOnMobile />`) — without it the phone would show the
 *    list skeleton and then swap to the thread;
 *  · the rail is `data-rail="auto"`, the same state Thread mounts it in, so it
 *    is a 290px column above 1180px and absent below it. Hardcoding "open"
 *    would put a 290px overlay across the thread on a tablet;
 *  · the list markup is duplicated from (dashboard)/loading.tsx rather than
 *    shared. A loading.tsx is a route file, not a component module, and this
 *    is ~40 lines of markup — not worth exporting a component out of a Next
 *    file convention for.
 */
export default function TicketLoading() {
  return (
    <>
      <MailListSkeleton />
      <ThreadSkeleton />
      <RailSkeleton />
    </>
  );
}

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
      data-hide-mobile
      aria-busy="true"
      aria-label="Loading messages"
    >
      <div className="pbm-list-head" aria-hidden>
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

/**
 * A bubble is a solid block in the real UI too, so it is drawn as one block
 * rather than as three stacked bars. The newlines are what give it its real
 * height: .pbm-bubble is `white-space: pre-wrap`, so each one is a genuine
 * 13.5px/1.55 line box.
 */
const NBSP = " ";
const BUBBLES: { out: boolean; lines: number; width: string }[] = [
  { out: false, lines: 3, width: "64%" },
  { out: true, lines: 2, width: "56%" },
  { out: false, lines: 2, width: "70%" },
  { out: true, lines: 4, width: "62%" },
];

function ThreadSkeleton() {
  return (
    <section
      className="pbm-thread pbk"
      aria-busy="true"
      aria-label="Loading conversation"
    >
      {/* 74px, fixed in mail.css — this header cannot shift. */}
      <header className="pbm-thread-head" aria-hidden>
        <div className="pbm-thread-who">
          <p className="pbm-thread-name pbk-text" style={{ width: 168 }}>
            &nbsp;
          </p>
          <p className="pbm-thread-email pbk-text" style={{ width: 208 }}>
            &nbsp;
          </p>
        </div>
        <div className="pbm-thread-actions">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="pbm-icon-btn pbk-fill" />
          ))}
        </div>
      </header>

      <div className="pbm-thread-subject" aria-hidden>
        <div className="pbm-subject pbk-text" style={{ width: "58%" }}>
          &nbsp;
        </div>
        <div className="pbm-subject-chips">
          <span className="pbm-chip-static pbk-fill" style={{ width: 88 }}>
            &nbsp;
          </span>
          <span className="pbm-status-btn pbk-fill" style={{ width: 92 }}>
            &nbsp;
          </span>
          <span className="pbm-chip-static pbk-fill" style={{ width: 76 }}>
            &nbsp;
          </span>
        </div>
        {/* The label row is present even with no labels — it always renders
            the dashed "add" control, and it carries a 9px top margin. */}
        <div className="pbm-labels">
          <span className="pbm-label-add pbk-fill" style={{ width: 64 }}>
            &nbsp;
          </span>
        </div>
      </div>

      <div className="pbm-transcript" aria-hidden>
        {BUBBLES.map((b, i) => (
          <div key={i} className="pbm-bubble-row" data-out={b.out || undefined}>
            <div className="pbm-bubble-wrap" style={{ width: b.width }}>
              <div className="pbm-bubble pbk-fill">
                {Array.from({ length: b.lines }, () => NBSP).join("\n")}
              </div>
              <p className="pbm-bubble-foot pbk-text" style={{ width: 104 }}>
                &nbsp;
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* The composer is real chrome, not data — but it arrives with the rest
          of the pane, so its box has to be reserved or the transcript would
          grow by ~90px when it lands. */}
      <div className="pbm-composer-wrap" aria-hidden>
        <div className="pbm-composer">
          <span className="pbm-composer-input pbk-text">&nbsp;</span>
          <span className="pbm-icon-btn pbk-fill" />
          <span className="pbm-send pbk-fill" style={{ width: 89 }} />
        </div>
        <p className="pbm-composer-foot pbk-text" style={{ width: "62%" }}>
          &nbsp;
        </p>
      </div>
    </section>
  );
}

function RailSkeleton() {
  return (
    <aside
      className="pbm-rail pbk"
      data-rail="auto"
      aria-busy="true"
      aria-label="Loading contact details"
    >
      <div className="pbm-rail-head" aria-hidden>
        <span className="pbm-rail-title pbk-text" style={{ width: 92 }}>
          &nbsp;
        </span>
        <span className="pbm-rail-close pbk-fill" />
      </div>

      <div className="pbm-rail-card" aria-hidden>
        <div>
          <p className="pbm-rail-name pbk-text" style={{ width: "62%" }}>
            &nbsp;
          </p>
          <p className="pbm-rail-void pbk-text" style={{ width: "78%" }}>
            &nbsp;
          </p>
        </div>
        {/* Email, First contact, Tickets, Status — four label/value pairs, the
            same four ContactRail renders. */}
        {["84%", "58%", "70%", "48%"].map((w, i) => (
          <div key={i}>
            <p className="pbm-rail-label pbk-text" style={{ width: 54 }}>
              &nbsp;
            </p>
            <p className="pbm-rail-value pbk-text" style={{ width: w }}>
              &nbsp;
            </p>
          </div>
        ))}
      </div>

      <span className="pbm-rail-title pbm-rail-title--sub pbk-text" style={{ width: 58 }} aria-hidden>
        &nbsp;
      </span>
      <div className="pbm-rail-card pbm-rail-card--empty" aria-hidden>
        <p className="pbm-rail-void pbk-text" style={{ width: "88%" }}>
          &nbsp;
        </p>
      </div>

      <div className="pbm-rail-sections" aria-hidden>
        {[112, 96, 104, 124].map((w, i) => (
          <span key={i} className="pbm-rail-row">
            <span className="pbk-text" style={{ width: w }}>
              &nbsp;
            </span>
            <span className="pbm-rail-soon pbk-fill" style={{ width: 44 }}>
              &nbsp;
            </span>
          </span>
        ))}
      </div>
    </aside>
  );
}
