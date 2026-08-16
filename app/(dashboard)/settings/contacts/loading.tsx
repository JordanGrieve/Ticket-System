import "../../../skeleton.css";

/**
 * /settings/contacts.
 *
 * The real page is still built from inline styles (it predates settings.css),
 * so there are no classes to borrow here — the numbers below are copied
 * one-for-one from contacts/page.tsx and are the only place in this feature
 * where geometry is restated. If that page is ever moved onto classes, this
 * should follow it and the duplication should go.
 *
 *   column   max-width 760, centred, padding 28px 32px 64px
 *   heading  22px, sub-line 13px with a 3px top margin
 *   list     20px below the sub-line
 *   row      13px/16px padding, 12px radius, 7px vertical margin, 14px gap,
 *            34px round avatar — which makes the row 62px tall
 *
 * One thing that is deliberately NOT copied: the real row paints `#fff` on a
 * `#efeadf` border, which is wrong in five of the six themes. The skeleton
 * uses --surface / --border instead, so it is the same box in the right
 * colours. The row will change colour, not size, when the real list arrives.
 */
export default function ContactsLoading() {
  return (
    <div
      className="pbk"
      style={{ maxWidth: 760, margin: "0 auto", padding: "28px 32px 64px" }}
      aria-busy="true"
      aria-label="Loading contacts"
    >
      <div aria-hidden>
        <div className="pbk-text" style={{ fontSize: 22, width: 148 }}>
          &nbsp;
        </div>
        <div className="pbk-text" style={{ fontSize: 13, marginTop: 3, width: 262 }}>
          &nbsp;
        </div>

        <div style={{ marginTop: 20 }}>
          {[196, 154, 232, 178, 210, 166, 188, 144].map((w, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "13px 16px",
                margin: "7px 0",
              }}
            >
              <div
                className="pbk-fill"
                style={{ width: 34, height: 34, borderRadius: "50%" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pbk-text" style={{ fontSize: 14.5, width: w }}>
                  &nbsp;
                </div>
                <div
                  className="pbk-text"
                  style={{ fontSize: 13, width: w + 46, maxWidth: "100%" }}
                >
                  &nbsp;
                </div>
              </div>
              <div
                className="pbk-fill"
                style={{ width: 62, height: 20, borderRadius: 20 }}
              />
              <div className="pbk-fill" style={{ width: 56, height: 12, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
