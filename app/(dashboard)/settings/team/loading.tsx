import "../../../skeleton.css";

/**
 * /settings/team.
 *
 * The member list shares .stc-row with contacts, so the rows here are the
 * contacts skeleton's rows; the invite form below is one block, because its
 * height depends on which notice is showing and a guessed field-by-field
 * layout would shift when the real one arrived.
 */
export default function TeamLoading() {
  return (
    <div className="stg-wrap pbk" aria-busy="true" aria-label="Loading team">
      <header className="stg-head" aria-hidden>
        <div className="stg-title pbk-text" style={{ width: 68 }}>
          &nbsp;
        </div>
        <div className="stg-sub pbk-text" style={{ width: "70%" }}>
          &nbsp;
        </div>
      </header>

      <section className="stg-section" aria-hidden>
        <div className="stg-section-title pbk-text" style={{ width: 112 }}>
          &nbsp;
        </div>
        <ul className="stc-list">
          {[172, 204, 158].map((w, i) => (
            <li className="stc-row" key={i}>
              <span className="stc-avatar pbk-fill" />
              <span className="stc-person">
                <span className="stc-name pbk-text" style={{ width: w, maxWidth: "100%" }}>
                  &nbsp;
                </span>
                <span
                  className="stc-email pbk-text"
                  style={{ width: w + 52, maxWidth: "100%" }}
                >
                  &nbsp;
                </span>
              </span>
              <span className="stc-meta">
                <span className="stc-count pbk-fill" style={{ width: 58 }}>
                  &nbsp;
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="stg-section" aria-hidden>
        <div className="stg-section-title pbk-text" style={{ width: 138 }}>
          &nbsp;
        </div>
        <div className="stg-section-sub pbk-text" style={{ width: 300, maxWidth: "100%" }}>
          &nbsp;
        </div>
        <div className="pbk-fill" style={{ height: 96, borderRadius: 16 }} />
      </section>
    </div>
  );
}
