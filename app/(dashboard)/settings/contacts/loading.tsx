import "../../../skeleton.css";

/**
 * /settings/contacts.
 *
 * The sticky `.pbs-tabs` strip belongs to the settings layout and never
 * suspends, so it is not redrawn here.
 *
 * Everything below reuses the real .stc-* classes from settings.css, so no
 * geometry is restated: the column width, the page padding, the row's
 * padding/radius/gap, the 34px avatar and the two text line-boxes are all
 * declared exactly once, in the stylesheet, and the skeleton cannot drift
 * from the list it stands in for. The only inline values left are bar
 * widths, which have no counterpart in the real layout — they exist to make
 * the placeholder names look like names rather than a column of identical
 * bars.
 */
export default function ContactsLoading() {
  return (
    <div className="stc-wrap pbk" aria-busy="true" aria-label="Loading contacts">
      <div className="stc-col" aria-hidden>
        <header className="stc-head">
          <div className="stc-title pbk-text" style={{ width: 148 }}>
            &nbsp;
          </div>
          <div className="stc-sub pbk-text" style={{ width: 262 }}>
            &nbsp;
          </div>
        </header>

        <ul className="stc-list">
          {[196, 154, 232, 178, 210, 166, 188, 144].map((w, i) => (
            <li className="stc-row" key={i}>
              <span className="stc-avatar pbk-fill" />
              <span className="stc-person">
                <span className="stc-name pbk-text" style={{ width: w, maxWidth: "100%" }}>
                  &nbsp;
                </span>
                <span
                  className="stc-email pbk-text"
                  style={{ width: w + 46, maxWidth: "100%" }}
                >
                  &nbsp;
                </span>
              </span>
              <span className="stc-meta">
                <span className="stc-count pbk-fill" style={{ width: 62 }}>
                  &nbsp;
                </span>
                <span className="stc-seen pbk-text" style={{ width: 56 }}>
                  &nbsp;
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
