"use client";

import { useState } from "react";

/**
 * The thank-you a new subscriber gets the moment they confirm.
 *
 * ── WHY IT SITS UNDER NEWSLETTER BRANDING AND NOT IN ITS OWN TAB ──
 * The settings strip already carries nine tabs and overflows on a phone. This
 * is one toggle and two fields, and it belongs beside the other "what your
 * newsletter emails say" controls rather than becoming a tenth.
 *
 * ── OFF UNTIL SOMEBODY TURNS IT ON ──
 * The toggle defaults to false in the schema, so a workspace that has never
 * opened this screen sends nothing. Shipping a default that starts mailing a
 * client's customers is not a feature.
 *
 * No lib/config import, direct or transitive — client component, same rule as
 * the two forms above it.
 */
export default function WelcomeEmailForm({
  initial,
  hasPostalAddress,
}: {
  initial: { enabled: boolean; subject: string; body: string };
  /**
   * Whether Sender identity has an address. Without one the email cannot be
   * rendered at all (it is marketing mail and must carry one), so the screen
   * says that here rather than letting somebody turn a feature on that will
   * silently refuse every time.
   */
  hasPostalAddress: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function touch() {
    setSaved(false);
    setError(null);
  }

  async function save(next?: { enabled: boolean }) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/welcome", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: next ? next.enabled : enabled,
          subject,
          body,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Couldn’t save that.");
        // Put the toggle back: the screen must not show something on that the
        // server refused to turn on.
        if (next) setEnabled(!next.enabled);
        return;
      }
      if (next) setEnabled(next.enabled);
      setSaved(true);
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
      if (next) setEnabled(!next.enabled);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stg-identity">
      <div className="stg-switch-row">
        <span className="stg-field-label">Send a thank-you when somebody subscribes</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Send a thank-you when somebody subscribes"
          className="st-switch"
          data-on={enabled}
          disabled={saving || !hasPostalAddress}
          onClick={() => void save({ enabled: !enabled })}
        >
          <span className="st-switch-knob" aria-hidden />
        </button>
      </div>

      {!hasPostalAddress && (
        <p className="stg-identity-warn" role="status">
          <b>Postal address missing</b> — add one under Sender identity above.
        </p>
      )}

      <label className="stg-field">
        <span className="stg-field-label">Subject</span>
        <input
          className="stg-input"
          type="text"
          value={subject}
          maxLength={200}
          disabled={saving}
          onChange={(e) => {
            setSubject(e.target.value);
            touch();
          }}
        />
      </label>

      <label className="stg-field">
        <span className="stg-field-label">Message</span>
        <textarea
          className="stg-input stg-textarea"
          value={body}
          rows={10}
          maxLength={5000}
          disabled={saving}
          onChange={(e) => {
            setBody(e.target.value);
            touch();
          }}
        />
        <span className="stg-field-hint">
          {"{first_name}"} and {"{company}"} are filled in when it sends. The
          unsubscribe link and your postal address are added automatically.
        </span>
      </label>

      <div className="stg-identity-actions">
        <button
          className="stg-button"
          type="button"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span className="stg-identity-ok" role="status">
            Saved
          </span>
        )}
        {error && (
          <span className="stg-identity-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
