import "../../../skeleton.css";

/**
 * /settings/access-log.
 *
 * The three summary tiles are a fixed, predictable layout and worth drawing
 * shape-for-shape in the real .stg-al-* classes. The visits below them are
 * not — a visit with a reason and a list of opened records is three times the
 * height of one without — so they are three equal blocks.
 */
export default function AccessLogLoading() {
  return (
    <div className="stg-wrap pbk" aria-busy="true" aria-label="Loading the access log">
      <header className="stg-head" aria-hidden>
        <div className="stg-title pbk-text" style={{ width: 118 }}>
          &nbsp;
        </div>
        <div className="stg-sub pbk-text" style={{ width: "78%" }}>
          &nbsp;
        </div>
      </header>

      <section className="stg-section" aria-hidden>
        <div className="stg-al-tiles">
          {[48, 64, 40].map((w, i) => (
            <div className="stg-al-tile" key={i}>
              <div className="stg-al-tile-value pbk-text" style={{ width: w }}>
                &nbsp;
              </div>
              <div className="stg-al-tile-label pbk-text" style={{ width: 92 }}>
                &nbsp;
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stg-section" aria-hidden>
        <div className="stg-section-title pbk-text" style={{ width: 104 }}>
          &nbsp;
        </div>
        <div className="stg-section-sub pbk-text" style={{ width: 280, maxWidth: "100%" }}>
          &nbsp;
        </div>
        {[112, 84, 132].map((h, i) => (
          <div className="pbk-fill" style={{ height: h, borderRadius: 16 }} key={i} />
        ))}
      </section>
    </div>
  );
}
