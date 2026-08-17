import "../../skeleton.css";

/**
 * /settings — the General tab.
 *
 * The sticky `.pbs-tabs` strip belongs to the settings layout and never
 * suspends, so it must NOT be redrawn here; painting a second one would double
 * it. Everything below reuses the real classes from settings.css, so the frame
 * (page padding, section gap, the 3-up theme grid and its collapse points, card
 * radii) is exact and nothing shifts when the real page swaps in.
 *
 * The theme grid is the one place worth imitating shape-for-shape: six equal
 * cards with a fixed-height swatch is a genuinely predictable layout, unlike
 * the rows underneath whose heights depend on how long an email address is.
 * Those get one block each.
 */
export default function GeneralLoading() {
  return (
    <div className="stg-wrap pbk" aria-busy="true" aria-label="Loading settings">
      <header className="stg-head" aria-hidden>
        <div className="stg-title pbk-text" style={{ width: 132 }}>
          &nbsp;
        </div>
        <div className="stg-sub pbk-text" style={{ width: "72%" }}>
          &nbsp;
        </div>
      </header>

      <section className="stg-section" aria-hidden>
        <div className="stg-section-title pbk-text" style={{ width: 108 }}>
          &nbsp;
        </div>
        <div className="stg-section-sub pbk-text" style={{ width: 260 }}>
          &nbsp;
        </div>
        <div className="stg-theme-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="stg-theme-card" key={i}>
              <div className="stg-theme-swatch pbk-fill" />
              <div className="stg-theme-foot">
                <div className="stg-theme-text" style={{ width: "100%" }}>
                  <div className="stg-theme-label pbk-text" style={{ width: 62 }}>
                    &nbsp;
                  </div>
                  <div className="stg-theme-note pbk-text" style={{ width: 104 }}>
                    &nbsp;
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stg-section" aria-hidden>
        <div className="stg-section-title pbk-text" style={{ width: 64 }}>
          &nbsp;
        </div>
        <div className="pbk-fill" style={{ height: 296, borderRadius: 20 }} />
      </section>

      <section className="stg-section" aria-hidden>
        <div className="stg-section-title pbk-text" style={{ width: 116 }}>
          &nbsp;
        </div>
        <div className="stg-section-sub pbk-text" style={{ width: 288 }}>
          &nbsp;
        </div>
        <div className="stg-int-grid">
          <div className="pbk-fill" style={{ height: 74, borderRadius: 18 }} />
          <div className="pbk-fill" style={{ height: 74, borderRadius: 18 }} />
        </div>
      </section>
    </div>
  );
}
