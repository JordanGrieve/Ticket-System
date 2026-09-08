import "../../../skeleton.css";
import "./forms.css";

/**
 * /settings/forms.
 *
 * Same story as labels/loading.tsx: it fell through to the General tab's
 * theme grid. The shapes here are the page's own — the quiet workspace-key
 * card, the "new form" row, and the list of form cards — all in the real
 * .pbf-* classes so nothing shifts when the page swaps in.
 */
export default function FormsLoading() {
  return (
    <div className="stg-wrap pbk" aria-busy="true" aria-label="Loading forms">
      <header className="stg-head" aria-hidden>
        <div className="stg-title pbk-text" style={{ width: 76 }}>
          &nbsp;
        </div>
        <div className="stg-sub pbk-text" style={{ width: "80%" }}>
          &nbsp;
        </div>
      </header>

      <div className="pbf-card pbf-card--default" aria-hidden>
        <div className="pbf-row">
          <div className="pbf-main">
            <div className="pbf-name pbk-text" style={{ width: 132 }}>
              &nbsp;
            </div>
            <div className="pbf-note pbk-text" style={{ width: 246, maxWidth: "100%" }}>
              &nbsp;
            </div>
          </div>
          <div className="pbf-count pbk-text" style={{ width: 64 }}>
            &nbsp;
          </div>
        </div>
      </div>

      <section className="pbf-new" aria-hidden>
        <div className="stg-h2 pbk-text" style={{ width: 96 }}>
          &nbsp;
        </div>
        <div className="pbf-newrow">
          <div className="pbf-input pbk-fill" style={{ flex: 1, height: 40 }} />
          <div className="pbf-btn pbk-fill" style={{ width: 112, height: 40 }} />
        </div>
      </section>

      <section aria-hidden>
        <div className="stg-h2 pbk-text" style={{ width: 84 }}>
          &nbsp;
        </div>
        <div className="pbf-list">
          {[148, 118].map((w, i) => (
            <div className="pbf-card" key={i}>
              <div className="pbf-row">
                <div className="pbf-main">
                  <div className="pbf-name pbk-text" style={{ width: w }}>
                    &nbsp;
                  </div>
                  <div className="pbf-note pbk-text" style={{ width: 210, maxWidth: "100%" }}>
                    &nbsp;
                  </div>
                </div>
                <div className="pbf-count pbk-text" style={{ width: 64 }}>
                  &nbsp;
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
