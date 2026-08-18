import "../../skeleton.css";
import "../../newsletter.css";

/**
 * /newsletters skeleton.
 *
 * Reuses the real .nl-* classes so the frame — rail width, card radii, page
 * padding, the two-up grid and its collapse points — is exact and nothing
 * shifts when the composer swaps in. Only the shapes inside the cards are
 * approximated, and only where their height is predictable: the preview frame
 * has a fixed height, so it is worth imitating; the help text underneath every
 * field is not, so the fields get one block each.
 */
export default function NewslettersLoading() {
  return (
    <div className="pbm-page pb-scroll">
      <div
        className="nl-wrap pbk"
        aria-busy="true"
        aria-label="Loading newsletters"
      >
        <aside className="nl-rail" aria-hidden>
          <div className="nl-rail-head">
            <div className="nl-rail-title pbk-text" style={{ width: 116 }}>
              &nbsp;
            </div>
            <div className="pbk-fill" style={{ width: 58, height: 32, borderRadius: 11 }} />
          </div>
          <div className="nl-list">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="pbk-fill"
                style={{ height: 74, borderRadius: 13 }}
              />
            ))}
          </div>
        </aside>

        <div className="nl-main" aria-hidden>
          <header className="nl-head">
            <div className="nl-head-text" style={{ flex: 1 }}>
              <div className="nl-title pbk-text" style={{ width: 168 }}>
                &nbsp;
              </div>
              <div className="nl-sub pbk-text" style={{ width: "70%" }}>
                &nbsp;
              </div>
            </div>
            <div className="pbk-fill" style={{ width: 116, height: 40, borderRadius: 12 }} />
          </header>

          <div className="nl-grid">
            <div className="nl-col">
              <div className="pbk-fill" style={{ height: 372, borderRadius: 18 }} />
              <div className="pbk-fill" style={{ height: 330, borderRadius: 18 }} />
            </div>
            <div className="nl-col">
              <div className="pbk-fill" style={{ height: 700, borderRadius: 18 }} />
              <div className="pbk-fill" style={{ height: 260, borderRadius: 18 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
