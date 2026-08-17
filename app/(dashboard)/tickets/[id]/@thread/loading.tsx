import "../../../../skeleton.css";

/**
 * Fallback for the @thread slot ONLY — the conversation and the contact rail.
 *
 * This is the file that fixes the reported flicker. It used to be
 * tickets/[id]/loading.tsx, which sat above the list pane as well and so had
 * to skeleton all three columns; now it is scoped to the slot, and the list
 * pane beside it is left alone. See ../layout.tsx for the measurements.
 *
 * Two details that are easy to get wrong here:
 *
 *  · there is no list skeleton in this file, and there must not be. The list
 *    is a sibling slot that is not inside this boundary; drawing one here
 *    would put a second 336px column next to the real one;
 *  · the rail is `data-rail="auto"`, the same state Thread mounts it in, so it
 *    is a 290px column above 1180px and absent below it. Hardcoding "open"
 *    would put a 290px overlay across the thread on a tablet.
 *
 * The thread pane carries no `data-hide-mobile`: on a phone the thread IS the
 * screen while a ticket is open, and the list is the pane that hides.
 */
export default function ThreadSlotLoading() {
  return (
    <>
      <ThreadSkeleton />
      <RailSkeleton />
    </>
  );
}

/**
 * A bubble is a solid block in the real UI too, so it is drawn as one block
 * rather than as three stacked bars. The newlines are what give it its real
 * height: .pbm-bubble is `white-space: pre-wrap`, so each one is a genuine
 * 13.5px/1.55 line box.
 */
const NBSP = " ";
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

      <span
        className="pbm-rail-title pbm-rail-title--sub pbk-text"
        style={{ width: 58 }}
        aria-hidden
      >
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
