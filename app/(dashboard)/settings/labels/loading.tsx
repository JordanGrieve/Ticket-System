import "../../../skeleton.css";

/**
 * /settings/labels.
 *
 * This route used to fall through to settings/loading.tsx, which draws the
 * General tab — a six-card theme grid. Navigating Contacts → Labels therefore
 * flashed a grid of swatches and then replaced it with a list of label rows,
 * which is worse than no skeleton at all. Jordan's report on 8 Sep 2026:
 * "Labels has not got a skeleton on load".
 *
 * Reuses the real .pbm-label-row geometry from mail.css, so the rows are the
 * height the LabelManager's rows are.
 */
export default function LabelsLoading() {
  return (
    <div className="stg-wrap pbk" aria-busy="true" aria-label="Loading labels">
      <header className="stg-head" aria-hidden>
        <div className="stg-title pbk-text" style={{ width: 84 }}>
          &nbsp;
        </div>
        <div className="stg-sub pbk-text" style={{ width: "76%" }}>
          &nbsp;
        </div>
      </header>

      <section className="stg-section" aria-hidden>
        {[92, 118, 76, 140, 104].map((w, i) => (
          <div className="pbm-label-row" key={i}>
            <span className="pbm-label pbk-fill" style={{ width: w, height: 26 }} />
            <span className="pbm-label-count pbk-text" style={{ width: 28 }}>
              &nbsp;
            </span>
            <span style={{ flex: 1 }} />
            <span className="pbm-label-icon pbk-fill" />
            <span className="pbm-label-icon pbk-fill" />
          </div>
        ))}
        <div className="pbm-label-row pbm-label-row--new">
          <span className="pbm-label-input pbk-fill" style={{ height: 38, flex: 1 }} />
          <span className="pbm-label-create pbk-fill" style={{ width: 88, height: 38 }} />
        </div>
      </section>
    </div>
  );
}
