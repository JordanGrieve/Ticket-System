import "../../../skeleton.css";

/**
 * /settings/install.
 *
 * ── WHY THIS WAS REWRITTEN ──
 * It restated the page's frame inline — `maxWidth: 760, margin: "0 auto",
 * padding: "34px 32px 64px"` — with a comment listing the geometry it was
 * copying. Every one of those numbers was a copy of a stylesheet rule, so the
 * skeleton could only stay right for as long as nobody changed the page. The
 * column cap came off on 13 Sep 2026 and Install went full width like every
 * other settings tab; the skeleton stayed 760px and centred, so the placeholder
 * was visibly a different shape from the thing it stood for, and it flicked to
 * full width the moment the real page arrived. A section was deleted the next
 * day and it still drew five.
 *
 * So it reuses the real .sti-* classes now, the way the contacts skeleton
 * reuses .stc-*. settings.css is imported by the settings layout, which this
 * renders inside, so the classes are already there. The column width, page
 * padding, section radius/padding/margin and every line-height come from the
 * stylesheet exactly once and cannot drift again.
 *
 * ── THE NUMBERS THAT ARE STILL HERE ──
 * Bar widths and line counts, which have no counterpart in CSS: they exist so
 * the placeholder reads as a page rather than a column of identical bars.
 * They were measured off the rendered page at 1180px on 14 Sep 2026 — the
 * heights they add up to are 511 / 680 / 258 / 331, matching the four real
 * sections. They are a likeness, not a promise; a line more or less as text
 * rewraps is not drift, a section count is.
 *
 * `.pbm-page > *` (mail.css) forces `height: auto !important` on this root, so
 * the skeleton must not set a height of its own.
 */

/** A paragraph, as `n` line bars. The last is short, the way prose ends. */
function Prose({ lines, last = "62%" }: { lines: number; last?: string }) {
  return (
    <div className="sti-help">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="pbk-text"
          style={{
            fontSize: "0.8125rem",
            lineHeight: 1.6,
            width: i === lines - 1 ? last : "100%",
          }}
        >
          &nbsp;
        </div>
      ))}
    </div>
  );
}

/** The 44px toggle row: two pills, wide then narrow. */
function Modes({ widths }: { widths: [number, number] }) {
  return (
    <div className="sti-modes">
      {widths.map((w, i) => (
        <div
          key={i}
          className="pbk-fill"
          style={{ width: w, height: 44, borderRadius: 10 }}
        />
      ))}
    </div>
  );
}

/** A copyable value and its button, as one 44px bar. */
function FieldRow() {
  return <div className="pbk-fill" style={{ height: 44, borderRadius: 10 }} />;
}

/** A collapsed code block. 300px is the cap in settings.css. */
function CodeBlock() {
  return <div className="pbk-fill" style={{ height: 302, borderRadius: 12 }} />;
}

export default function InstallLoading() {
  return (
    <div className="sti-wrap pbk" aria-busy="true" aria-label="Loading install settings">
      <div className="sti-col" aria-hidden>
        <div className="sti-title pbk-text" style={{ width: 216 }}>
          &nbsp;
        </div>
        <div className="sti-sub pbk-text" style={{ width: "62%", maxWidth: "62ch" }}>
          &nbsp;
        </div>

        {/* 1 · Connect your contact form */}
        <section className="sti-section">
          <div className="sti-section-title pbk-text" style={{ width: 208 }}>
            &nbsp;
          </div>
          <Modes widths={[212, 92]} />
          <Prose lines={3} last="48%" />
          <CodeBlock />
        </section>

        {/* 2 · Add a newsletter signup — the long one: two paragraphs. */}
        <section className="sti-section">
          <div className="sti-section-title pbk-text" style={{ width: 196 }}>
            &nbsp;
          </div>
          <Modes widths={[212, 84]} />
          <Prose lines={3} last="54%" />
          <div className="sti-sub-title pbk-text" style={{ width: 268 }}>
            &nbsp;
          </div>
          <Prose lines={7} last="38%" />
          <CodeBlock />
        </section>

        {/* 3 · Forward your email here (optional) */}
        <section className="sti-section">
          <div className="sti-section-title pbk-text" style={{ width: 262 }}>
            &nbsp;
          </div>
          <Prose lines={6} last="30%" />
          <FieldRow />
        </section>

        {/* Settings — two labelled values and the download button. */}
        <section className="sti-section">
          <div className="sti-section-title pbk-text" style={{ width: 74 }}>
            &nbsp;
          </div>
          <div className="sti-label pbk-text" style={{ width: 132 }}>
            &nbsp;
          </div>
          <Prose lines={2} last="44%" />
          <FieldRow />

          <div className="sti-gap--lg" />
          <div className="sti-label pbk-text" style={{ width: 84 }}>
            &nbsp;
          </div>
          <Prose lines={2} last="52%" />
          <div
            className="pbk-fill"
            style={{ width: 158, height: 44, borderRadius: 9 }}
          />
        </section>
      </div>
    </div>
  );
}
