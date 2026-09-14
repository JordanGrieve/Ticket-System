import "../../../skeleton.css";
import "../../../settings.css";

/**
 * /newsletters/welcome.
 *
 * Reuses the real .stg-* classes, so the column width, section padding and
 * every line-height come from the stylesheet exactly once. The install
 * skeleton restated its frame inline and was still drawing a 760px centred
 * column weeks after that page went full width — a placeholder that copies
 * geometry only stays right until somebody edits the page it stands for.
 *
 * The shapes are the form's: a switch row, two text fields, the layout
 * buttons, the image field, and the preview panel, which is the tall one.
 */
export default function WelcomeNewsletterLoading() {
  return (
    <div className="pbm-page pb-scroll pbk" aria-busy="true" aria-label="Loading the welcome newsletter">
      <div className="stg-wrap" aria-hidden>
        <header className="stg-head">
          <div className="stg-title pbk-text" style={{ width: 232 }}>
            &nbsp;
          </div>
          <div className="stg-sub pbk-text" style={{ width: "58%" }}>
            &nbsp;
          </div>
        </header>

        <section className="stg-section">
          {/* The on/off row: a label and the switch at the end of it. */}
          <div className="stg-switch-row">
            <span className="stg-field-label pbk-text" style={{ width: 268 }}>
              &nbsp;
            </span>
            <span
              className="pbk-fill"
              style={{ width: 48, height: 28, borderRadius: 14 }}
            />
          </div>

          {[132, 96].map((w, i) => (
            <div className="stg-field" key={i}>
              <span className="stg-field-label pbk-text" style={{ width: w }}>
                &nbsp;
              </span>
              <span
                className="pbk-fill"
                style={{ height: i === 1 ? 180 : 44, borderRadius: 10 }}
              />
            </div>
          ))}

          <div className="stg-fieldset">
            <span className="stg-field-label pbk-text" style={{ width: 62 }}>
              &nbsp;
            </span>
            <div className="stg-seg">
              {[104, 82].map((w) => (
                <span
                  key={w}
                  className="pbk-fill"
                  style={{ width: w, height: 44, borderRadius: 11 }}
                />
              ))}
            </div>
          </div>

          <div className="stg-field">
            <span className="stg-field-label pbk-text" style={{ width: 148 }}>
              &nbsp;
            </span>
            <span className="pbk-fill" style={{ height: 44, borderRadius: 10 }} />
          </div>

          {/* The preview. Tall on purpose — it is the tallest thing on the real
              page, and a short placeholder here would make the content jump. */}
          <div className="stg-preview">
            <div className="stg-preview-head">
              <span className="stg-field-label pbk-text" style={{ width: 64 }}>
                &nbsp;
              </span>
            </div>
            <span
              className="pbk-fill"
              style={{ display: "block", height: 520 }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
