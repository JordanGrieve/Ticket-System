import "../../skeleton.css";

/**
 * The hosted signup form, while its workspace is being looked up.
 *
 * ── WHY THIS PAGE HAS ONE AND MOST PUBLIC PAGES DO NOT ──
 * A loading.tsx only ever renders if the segment actually suspends. Nearly
 * every other public page here is either prerendered (/pricing, /privacy,
 * /terms, /s/done) or "dynamic" only because it awaits searchParams, which
 * costs nothing — a skeleton on those would be dead code at best and a
 * one-frame flash at worst.
 *
 * This one is different: it awaits getWorkspaceByApiKey, a real database round
 * trip over neon-http, before it can render anything at all. And it is the
 * page a STRANGER lands on from a client's website having clicked "subscribe",
 * with no session and no reason to wait — the audience least willing to look
 * at a blank screen and most likely to read one as broken.
 *
 * ── THE NAME IS THE ONE THING THAT CANNOT BE DRAWN ──
 * The heading is "Subscribe to {workspace name}", and the workspace name IS
 * what the query is fetching. So the placeholder shows a bar where the title
 * goes rather than inventing a title — guessing "Subscribe to…" and then
 * replacing it would be a visible change of words, which reads worse than a
 * bar becoming text.
 *
 * Every element wears the REAL .s-* class from app/s/subscribe.css, so the
 * card padding, field spacing, input height and button size are declared once
 * and this cannot drift from the form it stands in for. skeleton.css only
 * paints a fill over them — .pbk-fill for a whole box (the inputs, the
 * button), .pbk-text for a line of type. The sole inline values are bar widths, which have
 * no counterpart in the real layout.
 */
export default function SubscribeLoading() {
  return (
    <div className="s-card pbk" aria-busy="true" aria-label="Loading the signup form">
      <div aria-hidden>
        {/* The heading. A bar, because its text is the thing being fetched. */}
        <div className="pbk-text" style={{ width: "72%", height: 26 }}>
          &nbsp;
        </div>
        <div className="pbk-text" style={{ width: "94%", marginTop: 14 }}>
          &nbsp;
        </div>
        <div className="pbk-text" style={{ width: "61%" }}>
          &nbsp;
        </div>

        <div className="s-field" style={{ marginTop: 22 }}>
          <span className="s-label pbk-text" style={{ width: 132 }}>
            &nbsp;
          </span>
          {/* &nbsp; so the box gets the same line box the real input gets from
              its 15px type — without it an empty div collapses to padding
              alone and the skeleton is shorter than the form it precedes,
              which is a jump at exactly the moment content arrives. */}
          <div className="s-input pbk-fill">&nbsp;</div>
        </div>

        <div className="s-field">
          <span className="s-label pbk-text" style={{ width: 96 }}>
            &nbsp;
          </span>
          {/* &nbsp; so the box gets the same line box the real input gets from
              its 15px type — without it an empty div collapses to padding
              alone and the skeleton is shorter than the form it precedes,
              which is a jump at exactly the moment content arrives. */}
          <div className="s-input pbk-fill">&nbsp;</div>
        </div>

        <div className="s-button pbk-fill">&nbsp;</div>

        <div className="s-fine pbk-text" style={{ width: "88%", marginTop: 18 }}>
          &nbsp;
        </div>
      </div>
    </div>
  );
}
