import "../../../skeleton.css";

/**
 * /settings/auto-reply.
 *
 * Renders inside the settings layout, so the sticky `.pbs-tabs` strip is
 * already on screen above this and must NOT be redrawn here: it is part of the
 * layout, it never suspends, and painting a second one would double it.
 *
 * Note where this sits in the box model: `.pbm-page > *` in mail.css forces
 * `height: auto !important; overflow: visible !important; flex: 0 0 auto` onto
 * every direct child of the settings pane, and `.st-wrap` is one. That is
 * harmless for a skeleton — the pane itself is the scroll container — but it
 * does mean this must not try to be its own scroller.
 *
 * Deliberately few, large blocks. The real cards are tall and their heights
 * are content-driven (a three-line help note here, a wrapped day-picker
 * there), so a faithful bar-by-bar imitation would be a dozen small shimmers
 * that still ended up the wrong height. What IS matched exactly is the frame:
 * the 30px/32px page padding, the 18px column gap, the two-column grid and
 * its 1080px collapse, the 18px card radius — all inherited from settings.css.
 */
export default function SettingsLoading() {
  return (
    <div className="st-wrap pbk" aria-busy="true" aria-label="Loading settings">
      <header className="st-head" aria-hidden>
        <div className="st-head-text">
          <h1 className="st-title pbk-text" style={{ width: 168 }}>
            &nbsp;
          </h1>
          <p className="st-sub pbk-text" style={{ width: "82%" }}>
            &nbsp;
          </p>
        </div>
        <div className="st-head-actions">
          <span className="st-save pbk-fill" style={{ width: 108 }} />
        </div>
      </header>

      <div className="st-grid" aria-hidden>
        <div className="st-col">
          <Card titleWidth={148} subWidth="76%" bodyHeight={64} />
          <Card titleWidth={116} subWidth="64%" bodyHeight={188} />
          <Card titleWidth={92} subWidth="88%" bodyHeight={260} />
        </div>
        <div className="st-col">
          <Card titleWidth={124} subWidth="58%" bodyHeight={300} />
        </div>
      </div>
    </div>
  );
}

/** One `.st-card`: real border, radius, padding and 16px inner gap. */
function Card({
  titleWidth,
  subWidth,
  bodyHeight,
}: {
  titleWidth: number;
  subWidth: string;
  bodyHeight: number;
}) {
  return (
    <section className="st-card">
      <div>
        <h2 className="st-card-title pbk-text" style={{ width: titleWidth }}>
          &nbsp;
        </h2>
        <p className="st-card-sub pbk-text" style={{ width: subWidth }}>
          &nbsp;
        </p>
      </div>
      <div className="pbk-fill" style={{ height: bodyHeight, borderRadius: 12 }} />
    </section>
  );
}
