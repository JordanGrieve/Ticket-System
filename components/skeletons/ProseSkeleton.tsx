import "../../app/skeleton.css";

/**
 * The placeholder for a long document — /privacy and /terms.
 *
 * ── IT DOES NOT PRETEND TO BE THE WHOLE DOCUMENT ──
 * The privacy policy is nine sections and several thousand words. A skeleton
 * that mirrored all of it would be a second copy of the document's structure,
 * kept in step by hand, and wrong the first time a section was added. So this
 * draws a title, a date line and a few sections' worth of bars — enough to say
 * "a long text page is coming", which is the entire job.
 *
 * ── AND IT DOES NOT FILL THE VIEWPORT ──
 * Deliberately shorter than the real page. A placeholder that runs to the fold
 * invites scrolling through bars, and anything below the fold is unread by
 * definition during the moment this is on screen.
 */
export default function ProseSkeleton({ label }: { label: string }) {
  // Two sections, each a heading and a few lines at descending widths.
  const sections = [
    ["96%", "91%", "68%"],
    ["93%", "97%", "84%", "57%"],
  ];

  return (
    <div className="pbk" aria-busy="true" aria-label={label}>
      <div aria-hidden>
        <div className="pbk-text" style={{ width: "52%", height: 30 }}>
          &nbsp;
        </div>
        <div className="pbk-text" style={{ width: 180, marginTop: 10 }}>
          &nbsp;
        </div>

        {sections.map((lines, s) => (
          <div key={s} style={{ marginTop: 34 }}>
            <div className="pbk-text" style={{ width: "38%", height: 20 }}>
              &nbsp;
            </div>
            {lines.map((w, i) => (
              <div
                key={i}
                className="pbk-text"
                style={{ width: w, marginTop: i === 0 ? 14 : 8 }}
              >
                &nbsp;
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
