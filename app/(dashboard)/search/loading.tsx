import "../../skeleton.css";

/**
 * /search — the results pane while the four queries run.
 *
 * Renders where the page's children render: inside `<main class="pb-main
 * pbm-main">`, which mail.css lays out as a flex ROW. /search puts one
 * full-width pane there, so this is that one pane and nothing else.
 *
 * Every box carries its real class, so the padding, radii and row gap come
 * from mail.css and cannot drift from the real results.
 *
 * The search box itself is NOT skeletoned — it is a fixed 42px shell that is
 * about to be filled with the query the user already typed, so shimmering it
 * would only hide a control that is genuinely ready. Group headers are left
 * out too: how many groups come back is exactly what we do not know yet, and
 * inventing three of them would be inventing a shape of result.
 */
export default function SearchLoading() {
  return (
    <section className="pbm-results pbk" aria-busy="true" aria-label="Searching">
      <div className="pbm-results-head" aria-hidden>
        <div className="pbm-search pbm-search--go">
          <span
            className="pbm-search-icon pbk-fill"
            style={{ width: 16, height: 16, borderRadius: 5 }}
          />
          <span
            className="pbm-search-input pbk-text pbk-text--fixed"
            style={{ width: 172 }}
          >
            &nbsp;
          </span>
        </div>
        <p className="pbm-results-meta pbk-text" style={{ width: 108 }}>
          &nbsp;
        </p>
      </div>

      <div className="pbm-results-scroll">
        <div className="pbm-group">
          <div className="pbm-group-body" aria-hidden>
            {[
              { title: "62%", line: "38%", snippet: "88%" },
              { title: "48%", line: "44%", snippet: "72%" },
              { title: "71%", line: "31%", snippet: "80%" },
              { title: "55%", line: "40%", snippet: "66%" },
            ].map((r, i) => (
              <div className="pbm-result" key={i}>
                <div className="pbm-result-top">
                  <span className="pbm-result-title pbk-text" style={{ width: r.title }}>
                    &nbsp;
                  </span>
                  <span
                    className="pbm-result-time pbk-text pbk-text--fixed"
                    style={{ width: 28 }}
                  >
                    &nbsp;
                  </span>
                </div>
                <div className="pbm-result-line pbk-text" style={{ width: r.line }}>
                  &nbsp;
                </div>
                <p className="pbm-result-snippet pbk-text" style={{ width: r.snippet }}>
                  &nbsp;
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
