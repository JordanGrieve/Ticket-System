import "./feature-bento.css";

/**
 * The breadth of the product, in one screenful.
 *
 * ── WHY A GRID AND NOT MORE ALTERNATING SECTIONS ──
 * The three showcases above cost roughly 500px of scroll each, which is the
 * right price for the three things that decide whether somebody signs up. It
 * is the wrong price for the next seven. Past about four repeats of the same
 * left-right rhythm the eye stops reading the copy, and the page becomes long
 * without becoming more convincing.
 *
 * A grid answers a different question, too. The showcases are a sequence —
 * mail arrives, you answer it, you send a newsletter. This is a set: things
 * somebody scans in any order looking for the one that matters to them. That
 * is what a grid is for and what a stack of sections is not.
 *
 * ── THE FRAGMENTS ARE THE ICONS ──
 * Each cell carries a scrap of real interface rather than a glyph. An icon of
 * a clock says "something about time"; the actual held-until-you-open chip
 * says what the product does. It also means the cells cannot drift into
 * describing features that do not exist, because somebody has to draw the
 * thing.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──
 * The shared inbox, threaded replies and the newsletter are absent because the
 * three showcases above already show them properly. Repeating them here would
 * make the page say the same thing twice in two different ways, which reads as
 * padding. This grid is only what those sections do not cover.
 *
 * Every fragment is aria-hidden; the title and line beside it carry the
 * meaning for anyone not looking at it.
 */

export default function FeatureBento() {
  return (
    <ul className="pbento">
      {/* The dominant cell. Out-of-hours holding is the most distinctive thing
          the product does — and the one competitors get wrong by cheerfully
          answering at 2am as though somebody were there. */}
      <li className="pbento-cell pbento-cell--wide">
        <h3 className="pbento-title">Nobody waits until Monday</h3>
        <p className="pbento-body">
          Set your opening hours and Postbox acknowledges enquiries that arrive
          out of hours — <em>held</em> until you open, so it never claims
          somebody is around at 2am when they are not.
        </p>
        <div className="pbento-art pbento-art--hours" aria-hidden>
          <div className="pbento-chip pbento-chip--muted">
            Arrived 23:41 &middot; Saturday
          </div>
          <div className="pbento-chip pbento-chip--accent">
            Held &middot; sends when you open at 07:00
          </div>
        </div>
      </li>

      <li className="pbento-cell">
        <h3 className="pbento-title">You know who you are talking to</h3>
        <p className="pbento-body">
          Every thread shows when this person first got in touch and what they
          have asked before.
        </p>
        <div className="pbento-art" aria-hidden>
          <div className="pbento-mini">
            <span className="pbento-mini-k">First contact</span>
            <span className="pbento-mini-v">20 Aug 2026</span>
            <span className="pbento-mini-k">Tickets</span>
            <span className="pbento-mini-v">3 in this workspace</span>
          </div>
        </div>
      </li>

      <li className="pbento-cell">
        <h3 className="pbento-title">Labels and stars</h3>
        <p className="pbento-body">
          Sort the inbox the way your shop actually works, not the way a help
          desk thinks it should.
        </p>
        <div className="pbento-art pbento-art--row" aria-hidden>
          <span className="pbento-tag">Orders</span>
          <span className="pbento-tag">Wholesale</span>
          <span className="pbento-tag">Urgent</span>
        </div>
      </li>

      <li className="pbento-cell">
        <h3 className="pbento-title">Snooze and archive</h3>
        <p className="pbento-body">
          Put a thread out of sight until Tuesday. It comes back on its own, at
          the time you asked for.
        </p>
        <div className="pbento-art" aria-hidden>
          <div className="pbento-chip pbento-chip--accent">
            Hidden until Tuesday, 9:00 am
          </div>
        </div>
      </li>

      <li className="pbento-cell">
        <h3 className="pbento-title">Deleting is not losing</h3>
        <p className="pbento-body">
          Anything deleted sits in the trash for 30 days first. Customer
          correspondence should not vanish to a stray click.
        </p>
        <div className="pbento-art" aria-hidden>
          <div className="pbento-chip pbento-chip--muted">
            In the trash &middot; 30 days left
          </div>
        </div>
      </li>

      <li className="pbento-cell pbento-cell--full">
        <h3 className="pbento-title">Everyone answers as the shop</h3>
        <p className="pbento-body">
          Invite whoever helps out. Customers see your business, not a rota of
          individual names.
        </p>
        <div className="pbento-art pbento-art--row" aria-hidden>
          <span className="pbento-face">E</span>
          <span className="pbento-face">R</span>
          <span className="pbento-face">M</span>
          <span className="pbento-face pbento-face--plus">+2</span>
        </div>
      </li>
    </ul>
  );
}
