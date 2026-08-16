import "../../../skeleton.css";

/**
 * /settings/install.
 *
 * Like Contacts, InstallView is still inline-styled, so the frame is restated
 * here from components/InstallView.tsx:
 *
 *   column   max-width 760, centred, padding 34px 32px 64px
 *   heading  24px, sub-line 14px/1.6 with a 6px top margin
 *   section  24px top margin, 16px radius, 22px/24px padding, 15px title
 *            with 14px beneath it
 *
 * Four big blocks rather than forty small ones. This page is a stack of
 * prose, a ~30-line code block and a theme picker: the heights are wildly
 * uneven and nothing about the real content is inferable from a bar chart of
 * grey lines. Fewer, larger shapes say "a stack of cards is coming" honestly
 * and stop the shimmer reading as a progress bar that never finishes.
 *
 * `.pbm-page > *` (mail.css) forces `height: auto !important` on this root,
 * which is exactly why InstallView's own `height: 100vh` is neutralised too —
 * so the skeleton must not set a height of its own either.
 */
const SECTIONS = [
  { title: 208, body: 320 },
  { title: 176, body: 132 },
  { title: 96, body: 148 },
  { title: 74, body: 268 },
];

export default function InstallLoading() {
  return (
    <div className="pbk" aria-busy="true" aria-label="Loading install settings">
      <div
        style={{ maxWidth: 760, margin: "0 auto", padding: "34px 32px 64px" }}
        aria-hidden
      >
        <div className="pbk-text" style={{ fontSize: 24, width: 216 }}>
          &nbsp;
        </div>
        <div
          className="pbk-text"
          style={{ fontSize: 14, lineHeight: 1.6, marginTop: 6, width: "78%" }}
        >
          &nbsp;
        </div>

        {SECTIONS.map((s, i) => (
          <section
            key={i}
            style={{
              marginTop: 24,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: "22px 24px",
            }}
          >
            <div
              className="pbk-text"
              style={{ fontSize: 15, marginBottom: 14, width: s.title }}
            >
              &nbsp;
            </div>
            <div
              className="pbk-fill"
              style={{ height: s.body, borderRadius: 12 }}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
