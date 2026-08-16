import "../skeleton.css";

/**
 * /admin — the operator console.
 *
 * This used to re-export the dashboard's loading state, which meant the dark
 * console flashed a light `#faf8f4` full-screen panel with a centred logo on
 * it. It now draws the console's own shell.
 *
 * Renders inside `.pba-root` (which carries data-theme="dark"), so every token
 * below resolves to the dark palette exactly as the real console does — the
 * skeleton is dark even when the operator's own workspace is on the light
 * theme, which is the whole point of the console carrying its own theme.
 *
 * Geometry is entirely admin.css's: 18px page padding, the 28px shell radius,
 * the 250px sidebar, the 74px header, the 22px content padding and the 320px
 * drawer. The default section is "accounts" (see parseSection in
 * admin/page.tsx), so the accounts table + drawer is the correct shape to
 * reserve.
 *
 * The six nav labels are static and known, but they are drawn as blocks
 * rather than as text: a nav row that reads "Accounts" but does not navigate
 * is worse than one that plainly says nothing yet.
 */
export default function AdminLoading() {
  return (
    <div className="pba-page pbk" aria-busy="true" aria-label="Loading the admin console">
      <div className="pba-shell">
        <nav className="pba-side" aria-hidden>
          <div className="pba-brand">
            <span className="pba-brand-tile pbk-fill" />
            <span>
              <span className="pba-brand-name pbk-text" style={{ width: 88 }}>
                &nbsp;
              </span>
              <span className="pba-brand-sub pbk-text" style={{ width: 104, marginTop: 2 }}>
                &nbsp;
              </span>
            </span>
          </div>

          <div className="pba-divider" />

          <div className="pba-nav">
            {[84, 96, 104, 70, 118, 82].map((w, i) => (
              <span key={i} className="pba-navrow">
                <span className="pba-dot pbk-fill" />
                <span className="pba-navlabel pbk-text" style={{ width: w }}>
                  &nbsp;
                </span>
              </span>
            ))}
          </div>

          <div className="pba-side-foot">
            <div className="pba-whoami">
              <div className="pba-whoami-label pbk-text" style={{ width: 82 }}>
                &nbsp;
              </div>
              <div className="pba-whoami-email pbk-text" style={{ width: "88%" }}>
                &nbsp;
              </div>
              <div className="pba-signout pbk-text" style={{ width: 62, marginTop: 9 }}>
                &nbsp;
              </div>
            </div>
          </div>
        </nav>

        <div className="pba-main">
          {/* 74px, fixed in admin.css. */}
          <header className="pba-header" aria-hidden>
            <div className="pba-htitles">
              <div className="pba-htitle pbk-text" style={{ width: 132 }}>
                &nbsp;
              </div>
              <div className="pba-hsub pbk-text" style={{ width: 268, marginTop: 2 }}>
                &nbsp;
              </div>
            </div>
            <div className="pba-hactions">
              <span className="pba-search pbk-fill" style={{ width: 240, height: 40, borderRadius: 14 }} />
              <span className="pba-btn pbk-fill" style={{ width: 118 }} />
            </div>
          </header>

          <div className="pba-body">
            <main className="pba-content" aria-hidden>
              <div className="pba-tabs">
                {[74, 96, 88, 102].map((w, i) => (
                  <span key={i} className="pba-tab pbk-fill" style={{ width: w }} />
                ))}
              </div>

              <div className="pba-table">
                <div className="pba-thead">
                  <div className="pba-row pba-row-accounts">
                    {[64, 44, 52, 48, 40, 58].map((w, i) => (
                      <span key={i} className="pba-th pbk-text" style={{ width: w }}>
                        &nbsp;
                      </span>
                    ))}
                  </div>
                </div>
                <div className="pba-tbody">
                  {ROWS.map((r, i) => (
                    <div key={i} className="pba-row pba-row-accounts">
                      <span>
                        <span className="pba-cell-main pbk-text" style={{ width: r.name }}>
                          &nbsp;
                        </span>
                        <span className="pba-cell-sub pbk-text" style={{ width: r.sub }}>
                          &nbsp;
                        </span>
                      </span>
                      <span className="pba-num pbk-text" style={{ width: 28 }}>
                        &nbsp;
                      </span>
                      <span className="pba-num pbk-text" style={{ width: 24 }}>
                        &nbsp;
                      </span>
                      <span className="pba-td pbk-text" style={{ width: 56 }}>
                        &nbsp;
                      </span>
                      <span className="pba-pill pbk-fill" style={{ width: 64 }} />
                      <span className="pba-td pbk-text" style={{ width: 78 }}>
                        &nbsp;
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </main>

            <aside className="pba-drawer" aria-hidden>
              <div className="pba-drawer-head">
                <div className="pba-drawer-name pbk-text" style={{ width: "68%" }}>
                  &nbsp;
                </div>
              </div>

              <div className="pba-tiles">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="pba-tile">
                    <div className="pba-tile-value pbk-text" style={{ width: 42 }}>
                      &nbsp;
                    </div>
                    <div className="pba-tile-label pbk-text" style={{ width: 74, marginTop: 4 }}>
                      &nbsp;
                    </div>
                  </div>
                ))}
              </div>

              <div className="pba-drawer-actions">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="pba-btn pba-btn-block pbk-fill" />
                ))}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

const ROWS = [
  { name: 148, sub: 186 },
  { name: 112, sub: 214 },
  { name: 176, sub: 168 },
  { name: 128, sub: 202 },
  { name: 158, sub: 178 },
  { name: 104, sub: 226 },
];
