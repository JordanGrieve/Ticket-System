import "../../app/skeleton.css";

/**
 * The placeholder for a centred single-card page.
 *
 * Shared by the public subscribe and unsubscribe flows, which are the same
 * shape wearing different class prefixes: a card, a heading, a line or two of
 * explanation, and sometimes a control. Writing five near-identical files
 * would guarantee that the day one of them changed, four would not.
 *
 * ── WHY THESE PAGES HAVE A SKELETON AT ALL ──
 * Most of them render fast enough that the boundary never shows on a first
 * load. It is not the first load these are for: `loading.tsx` also drives the
 * Suspense boundary during CLIENT-SIDE navigation, while the RSC payload is in
 * flight — which happens on statically prerendered routes too, over whatever
 * connection the visitor actually has. A stranger on a train tapping through
 * the confirm flow is the case that matters, and it is invisible from a
 * developer's laptop.
 *
 * ── THE CLASS PREFIX IS A PROP ──
 * `.s-card` and `.u-card` are declared in their own stylesheets with their own
 * padding and radius. Passing the prefix means each placeholder inherits the
 * real card it stands in for, rather than this file re-declaring a box that
 * would drift from both.
 */
export default function CardSkeleton({
  prefix,
  lines = 2,
  button = false,
  label,
}: {
  /** "s" for the subscribe pages, "u" for unsubscribe. */
  prefix: "s" | "u";
  /** Body lines under the heading. */
  lines?: number;
  /** Whether the real page has a button to stand in for. */
  button?: boolean;
  /** What a screen reader is told is loading. */
  label: string;
}) {
  // Descending widths so the block reads as a paragraph rather than a stack of
  // identical bars. No relation to the real text, which is the point: nothing
  // here should be mistaken for content that has arrived.
  const widths = ["94%", "88%", "72%", "80%", "61%"];

  return (
    <div className={`${prefix}-card pbk`} aria-busy="true" aria-label={label}>
      <div aria-hidden>
        <div className="pbk-text" style={{ width: "68%", height: 26 }}>
          &nbsp;
        </div>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="pbk-text"
            style={{ width: widths[i % widths.length], marginTop: i === 0 ? 16 : 8 }}
          >
            &nbsp;
          </div>
        ))}
        {button && (
          // &nbsp; for the line box: an empty div carrying the button class
          // collapses to its padding and the placeholder would be shorter than
          // the page it precedes, which is a jump exactly as content arrives.
          <div className={`${prefix}-button pbk-fill`} style={{ marginTop: 20 }}>
            &nbsp;
          </div>
        )}
        <div className={`${prefix}-fine pbk-text`} style={{ width: "84%", marginTop: 18 }}>
          &nbsp;
        </div>
      </div>
    </div>
  );
}
