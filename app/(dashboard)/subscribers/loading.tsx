import "../../subscribers.css";
import "../../skeleton.css";

/**
 * /subscribers.
 *
 * Same contract as settings/contacts/loading.tsx: every box wears the REAL
 * .psb-* class and skeleton.css only paints a fill over it, so the column
 * width, page padding, row padding/radius/gap, the 34px avatar, the filter
 * pills and the two text line-boxes are declared exactly once — in
 * app/subscribers.css — and this placeholder cannot drift from the list it
 * stands in for.
 *
 * The only inline values are bar widths, which have no counterpart in the real
 * layout: they exist so the placeholder names read as names rather than as a
 * column of identical bars.
 */
export default function SubscribersLoading() {
  return (
    <div className="pbm-page pb-scroll">
      <div
        className="psb-wrap pbk"
        aria-busy="true"
        aria-label="Loading subscribers"
      >
        <div className="psb-col" aria-hidden>
          <header className="psb-head">
            <div className="psb-title pbk-text" style={{ width: 168 }}>
              &nbsp;
            </div>
            <div className="psb-sub pbk-text" style={{ width: 296 }}>
              &nbsp;
            </div>
          </header>

          <div className="psb-filters">
            {[62, 104, 116, 92, 108].map((w, i) => (
              <span className="psb-filter pbk-fill" key={i} style={{ width: w }}>
                &nbsp;
              </span>
            ))}
          </div>

          <ul className="psb-list">
            {[196, 154, 232, 178, 210, 166, 188, 144].map((w, i) => (
              <li className="psb-row" key={i}>
                <span className="psb-avatar pbk-fill" />
                <span className="psb-person">
                  <span
                    className="psb-name pbk-text"
                    style={{ width: w, maxWidth: "100%" }}
                  >
                    &nbsp;
                  </span>
                  <span
                    className="psb-email pbk-text"
                    style={{ width: w + 46, maxWidth: "100%" }}
                  >
                    &nbsp;
                  </span>
                </span>
                <span className="psb-meta">
                  <span className="psb-consent pbk-fill" style={{ width: 78 }}>
                    &nbsp;
                  </span>
                  <span className="psb-chip pbk-fill" style={{ width: 70 }}>
                    &nbsp;
                  </span>
                  <span className="psb-when pbk-text" style={{ width: 56 }}>
                    &nbsp;
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
