import "../../../subscribers.css";
import "../../../skeleton.css";

/**
 * /subscribers/[id].
 *
 * Deliberately shows NO banner-shaped block. The detail page's first element is
 * the consent verdict, in red, amber or green, and a coloured placeholder in
 * its position would flash a verdict this page does not yet know — on the one
 * screen in the product where a wrong-coloured box is a claim about the law.
 * The skeleton stands in for the identity header and the two fact cards only,
 * and the banner appears when there is something true to put in it.
 *
 * Everything else follows the same rule as the list skeleton: real .psb-*
 * classes, fills painted over them by skeleton.css, no geometry restated.
 */
export default function SubscriberDetailLoading() {
  return (
    <div className="pbm-page pb-scroll">
      <div
        className="psb-wrap pbk"
        aria-busy="true"
        aria-label="Loading subscriber"
      >
        <div className="psb-col" aria-hidden>
          <span className="psb-back pbk-text" style={{ width: 118 }}>
            &nbsp;
          </span>

          <header className="psb-identity">
            <span className="psb-avatar pbk-fill" />
            <span className="psb-identity-text">
              <span className="psb-identity-email pbk-text" style={{ width: 244 }}>
                &nbsp;
              </span>
              <span className="psb-identity-name pbk-text" style={{ width: 132 }}>
                &nbsp;
              </span>
            </span>
          </header>

          {[4, 5].map((rows, card) => (
            <section className="psb-card" key={card}>
              <div className="psb-card-title pbk-text" style={{ width: 152 }}>
                &nbsp;
              </div>
              <div className="psb-card-note pbk-text" style={{ width: 300 }}>
                &nbsp;
              </div>
              <dl className="psb-facts">
                {Array.from({ length: rows }, (_, i) => (
                  <div style={{ display: "contents" }} key={i}>
                    <dt className="psb-fact-k pbk-text" style={{ width: 96 }}>
                      &nbsp;
                    </dt>
                    <dd
                      className="psb-fact-v pbk-text"
                      style={{ width: 180 + i * 22, maxWidth: "100%" }}
                    >
                      &nbsp;
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
