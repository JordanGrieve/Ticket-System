import "../../app/home.css";
import "../../app/skeleton.css";

/**
 * The placeholder for the public marketing pages: /, /pricing, /contact.
 *
 * All three open the same way — the nav, then a band with a heading, a line of
 * subtext and something below it — so the placeholder draws that and stops.
 * What sits underneath differs wildly (a product shot, three price cards, a
 * form) and is below the fold on a phone anyway, so drawing it would be effort
 * spent on pixels nobody sees during the moment this is on screen.
 *
 * ── THE NAV IS REAL, NOT DRAWN ──
 * `.home-nav` and `.home-wrap` carry the page's padding and max-width, so the
 * placeholder sits exactly where the real content will. Bars drawn inside a
 * div of this file's own invention would land a few pixels off and shift as
 * the page arrived, which is the one thing a skeleton exists to prevent.
 */
export default function MarketingSkeleton({
  label,
  lines = 2,
  block,
}: {
  label: string;
  /** Lines of subtext under the heading. */
  lines?: number;
  /** Height of the block beneath, or 0 for none. */
  block?: number;
}) {
  return (
    <div className="pbk" aria-busy="true" aria-label={label}>
      <div aria-hidden>
        <div className="home-nav">
          <div className="pbk-text" style={{ width: 108, height: 20 }}>
            &nbsp;
          </div>
          <div style={{ display: "flex", gap: 18, marginLeft: "auto" }}>
            <div className="pbk-text" style={{ width: 58 }}>
              &nbsp;
            </div>
            <div className="pbk-text" style={{ width: 52 }}>
              &nbsp;
            </div>
            <div className="pbk-fill" style={{ width: 74, height: 34, borderRadius: 11 }} />
          </div>
        </div>

        <div className="home-wrap" style={{ paddingTop: 56 }}>
          <div className="pbk-text" style={{ width: "72%", height: 40 }}>
            &nbsp;
          </div>
          <div className="pbk-text" style={{ width: "54%", height: 40, marginTop: 10 }}>
            &nbsp;
          </div>
          {Array.from({ length: lines }, (_, i) => (
            <div
              key={i}
              className="pbk-text"
              style={{ width: i === lines - 1 ? "44%" : "66%", marginTop: i === 0 ? 22 : 8 }}
            >
              &nbsp;
            </div>
          ))}
          {block ? (
            <div
              className="pbk-fill"
              style={{ height: block, borderRadius: 20, marginTop: 30 }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
