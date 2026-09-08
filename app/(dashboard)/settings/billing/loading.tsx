import "../../../skeleton.css";

/**
 * /settings/billing.
 *
 * Two sections — the plan you are on, and the plans you could be on — each a
 * title, a line of explanation and one block. The block heights are a guess
 * and are meant to be: the real cards vary with the trial state and whether
 * Stripe is configured, and a skeleton that imitates one state precisely is
 * wrong in the others.
 */
export default function BillingLoading() {
  return (
    <div className="stg-wrap pbk" aria-busy="true" aria-label="Loading billing">
      <header className="stg-head" aria-hidden>
        <div className="stg-title pbk-text" style={{ width: 82 }}>
          &nbsp;
        </div>
        <div className="stg-sub pbk-text" style={{ width: "66%" }}>
          &nbsp;
        </div>
      </header>

      {[
        [128, 250, 118],
        [156, 296, 184],
      ].map(([title, sub, block], i) => (
        <section className="stg-section" aria-hidden key={i}>
          <div className="stg-section-title pbk-text" style={{ width: title }}>
            &nbsp;
          </div>
          <div className="stg-section-sub pbk-text" style={{ width: sub, maxWidth: "100%" }}>
            &nbsp;
          </div>
          <div className="pbk-fill" style={{ height: block, borderRadius: 18 }} />
        </section>
      ))}
    </div>
  );
}
