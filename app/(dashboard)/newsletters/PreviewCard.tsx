"use client";

import { useState } from "react";

/**
 * The preview card: envelope, the rendered email in a sandboxed frame, and the
 * plain-text part. It draws what the composer rendered; it renders nothing
 * itself, so there is still exactly one renderCampaign call on this screen.
 */
export default function PreviewCard({
  rendered,
  preheader,
}: {
  rendered: { subject: string; html: string; text: string };
  /** As typed — the envelope says so when it is blank. */
  preheader: string;
}) {
  const [view, setView] = useState<"desktop" | "mobile">("desktop");

  return (
    <section className="nl-card nl-card--preview">
      <div className="nl-preview-head">
        <div>
          <h3 className="nl-card-title">Preview</h3>
        </div>
        <div className="nl-seg" role="group" aria-label="Preview width">
          <button
            type="button"
            className="nl-seg-btn"
            data-on={view === "desktop"}
            aria-pressed={view === "desktop"}
            onClick={() => setView("desktop")}
          >
            Desktop
          </button>
          <button
            type="button"
            className="nl-seg-btn"
            data-on={view === "mobile"}
            aria-pressed={view === "mobile"}
            onClick={() => setView("mobile")}
          >
            Mobile
          </button>
        </div>
      </div>

      <div className="nl-envelope">
        <p className="nl-env-row">
          <span className="nl-env-key">Subject</span>
          <span className="nl-env-val">
            {rendered.subject || (
              <em className="nl-env-empty">No subject yet</em>
            )}
          </span>
        </p>
        <p className="nl-env-row">
          <span className="nl-env-key">Preview line</span>
          <span className="nl-env-val">
            {preheader.trim() ? (
              preheader
            ) : (
              <em className="nl-env-empty">
                None — the inbox will scrape your opening words
              </em>
            )}
          </span>
        </p>
      </div>

      {/*
        THE ONE PLACE ON THIS PAGE WITH COLOURS THAT ARE NOT TOKENS.
        The document inside carries the renderer's own inline styles
        because mail clients strip stylesheets — those bytes are the
        product, and theming them would make the preview a lie. They are
        confined to this sandboxed iframe: `sandbox=""` with no
        allow-list means no scripts, no navigation, no form submission,
        and no access to this origin. The frame's own chrome (the border
        and the paper it sits on) is tokenised in newsletter.css.
      */}
      <div className="nl-frame" data-view={view}>
        <iframe
          className="nl-iframe"
          title="Newsletter preview"
          sandbox=""
          srcDoc={rendered.html}
        />
      </div>

      <details className="nl-details">
        <summary className="nl-summary">
          Plain-text part (what text-only clients get)
        </summary>
        <pre className="nl-pre">{rendered.text}</pre>
      </details>
    </section>
  );
}
