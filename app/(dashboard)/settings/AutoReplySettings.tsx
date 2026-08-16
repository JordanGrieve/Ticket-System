"use client";

import { useMemo, useRef, useState } from "react";
import type { AutoReplyDelay, AutoReplySchedule, BusinessHours } from "@/db/schema";
import {
  DEFAULT_OUT_OF_HOURS_BODY,
  DELAY_LABELS,
  MERGE_TOKENS,
  SCHEDULE_LABELS,
  buildMergeValues,
  isDelaySupported,
  renderTemplate,
  type AutoReplyConfig,
} from "@/lib/auto-reply";
import {
  DAY_SHORT,
  DEFAULT_BUSINESS_HOURS,
  describeBusinessHours,
  evaluateSchedule,
  isWithinBusinessHours,
  zonedParts,
} from "@/lib/business-hours";

/**
 * Auto-reply settings + live preview.
 *
 * The preview is composed with the SAME `renderTemplate` / `buildMergeValues`
 * the send path uses (that is why lib/auto-reply.ts holds no database or mail
 * imports). A preview that renders tokens differently from the sender is worse
 * than no preview at all — it would show "Hi Alex," while the customer got
 * "Hi {first_name},".
 */

const DELAYS: AutoReplyDelay[] = ["immediate", "5min", "1hr"];
const SCHEDULES: AutoReplySchedule[] = ["always", "business_hours", "out_of_hours"];

/** Fallback list when the browser can't enumerate zones. */
const FALLBACK_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function timeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported?.length) return supported;
  } catch {
    // Older engine — fall through.
  }
  return FALLBACK_ZONES;
}

type FieldKey = "subject" | "body" | "outOfHoursBody";

export default function AutoReplySettings({
  initialConfig,
  configured,
  workspaceName,
}: {
  initialConfig: AutoReplyConfig;
  configured: boolean;
  workspaceName: string;
}) {
  const [config, setConfig] = useState<AutoReplyConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Preview controls.
  const [previewNamed, setPreviewNamed] = useState(true);
  const [previewOutOfHours, setPreviewOutOfHours] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const oohRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<FieldKey>("body");

  const zones = useMemo(() => timeZones(), []);
  const hours = config.businessHours;

  function patch(next: Partial<AutoReplyConfig>) {
    setConfig((c) => ({ ...c, ...next }));
    setDirty(true);
    setSaved(false);
  }

  function patchHours(next: Partial<BusinessHours>) {
    const base = hours ?? DEFAULT_BUSINESS_HOURS;
    patch({ businessHours: { ...base, ...next } });
  }

  function toggleDay(day: number) {
    const base = hours ?? DEFAULT_BUSINESS_HOURS;
    const days = base.days.includes(day)
      ? base.days.filter((d) => d !== day)
      : [...base.days, day].sort((a, b) => a - b);
    patch({ businessHours: { ...base, days } });
  }

  /** Insert a merge token at the caret of whichever editor was last focused. */
  function insertToken(token: string) {
    const key = lastFocused.current;
    const el =
      key === "subject"
        ? subjectRef.current
        : key === "body"
          ? bodyRef.current
          : oohRef.current;
    if (!el) return;

    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);

    if (key === "subject") patch({ subject: next });
    else if (key === "body") patch({ body: next });
    else patch({ outOfHoursBody: next });

    // Restore the caret after React re-renders the controlled value.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auto-reply", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const payload = (await res.json()) as { error?: string; config?: AutoReplyConfig };
      if (!res.ok) {
        setError(payload.error ?? "Couldn't save those settings.");
      } else {
        if (payload.config) setConfig(payload.config);
        setSaved(true);
        setDirty(false);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Live preview ───────────────────────────────────────────────
  const values = buildMergeValues({
    customerName: previewNamed ? "alex fenton" : "",
    customerEmail: "alex@example.com",
    formName: null,
    source: "contact_form",
    workspaceName,
  });

  const previewBodyTemplate =
    previewOutOfHours && config.outOfHoursBody?.trim()
      ? config.outOfHoursBody
      : config.body;

  const previewSubject = renderTemplate(config.subject, values);
  const previewBody = renderTemplate(previewBodyTemplate, values);

  // "What would happen right now", using the same evaluator as the send path.
  const now = new Date();
  const nowInZone = zonedParts(now, config.timezone);
  const inHoursNow = isWithinBusinessHours(now, hours, config.timezone);
  const scheduleNow = evaluateSchedule(
    config.scheduleMode,
    now,
    hours,
    config.timezone,
  );
  const clock = `${String(nowInZone.hour).padStart(2, "0")}:${String(
    nowInZone.minute,
  ).padStart(2, "0")}`;

  const hoursNeeded =
    config.scheduleMode !== "always" || !!config.outOfHoursBody?.trim();

  return (
    <div className="st-wrap">
      <header className="st-head">
        <div className="st-head-text">
          <h1 className="st-title">Auto-reply</h1>
          <p className="st-sub">
            Send an instant acknowledgement so people know their message landed.
            It goes out once per enquiry, never to a robot, and never on top of a
            teammate&rsquo;s reply.
          </p>
        </div>
        <div className="st-head-actions">
          {saved && (
            <span className="st-saved" role="status">
              Saved
            </span>
          )}
          <button
            type="button"
            className="st-save"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </header>

      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}

      {!configured && (
        <p className="st-note">
          Auto-replies haven&rsquo;t been set up for this workspace yet — what
          you see below are suggested defaults. Nothing is sent until you turn
          them on and save.
        </p>
      )}

      <div className="st-grid">
        {/* ── Left: the form ─────────────────────────────────── */}
        <div className="st-col">
          <section className="st-card">
            <div className="st-toggle-row">
              <div>
                <h2 className="st-card-title">Send auto-replies</h2>
                <p className="st-card-sub">
                  Applies to new enquiries from your forms and your inbound email
                  address.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                aria-label="Send auto-replies"
                className="st-switch"
                data-on={config.enabled}
                onClick={() => patch({ enabled: !config.enabled })}
              >
                <span className="st-switch-knob" aria-hidden />
              </button>
            </div>
          </section>

          <section className="st-card">
            <h2 className="st-card-title">When to send</h2>

            <fieldset className="st-field">
              <legend className="st-label">Delay</legend>
              <div className="st-seg" role="group" aria-label="Send delay">
                {DELAYS.map((d) => {
                  const supported = isDelaySupported(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className="st-seg-btn"
                      data-on={config.delay === d}
                      disabled={!supported}
                      aria-pressed={config.delay === d}
                      title={
                        supported
                          ? undefined
                          : "Delayed sending isn't built — there's no queue or scheduled worker to wake up and send it."
                      }
                      onClick={() => patch({ delay: d })}
                    >
                      {DELAY_LABELS[d]}
                      {!supported && <span className="st-seg-tag">not built</span>}
                    </button>
                  );
                })}
              </div>
              <p className="st-help st-help--warn">
                Only immediate sending is available. A delayed acknowledgement
                has to survive the HTTP response returning, and this app runs on
                serverless functions with no job queue and no scheduled worker —
                so there is nothing alive to send it later. Offering the option
                would mean enabling auto-replies and silently sending nothing.
              </p>
            </fieldset>

            <fieldset className="st-field">
              <legend className="st-label">Schedule</legend>
              <div className="st-seg st-seg--stack" role="group" aria-label="Schedule">
                {SCHEDULES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="st-seg-btn"
                    data-on={config.scheduleMode === s}
                    aria-pressed={config.scheduleMode === s}
                    onClick={() => patch({ scheduleMode: s })}
                  >
                    {SCHEDULE_LABELS[s]}
                  </button>
                ))}
              </div>
            </fieldset>

            {hoursNeeded && (
              <>
                <fieldset className="st-field">
                  <legend className="st-label">Business hours</legend>
                  <div className="st-days" role="group" aria-label="Open days">
                    {DAY_SHORT.map((label, index) => {
                      const on = (hours ?? DEFAULT_BUSINESS_HOURS).days.includes(
                        index,
                      );
                      return (
                        <button
                          key={label}
                          type="button"
                          className="st-day"
                          data-on={on}
                          aria-pressed={on}
                          aria-label={label}
                          onClick={() => toggleDay(index)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="st-times">
                    <label className="st-time">
                      <span className="st-label-sm">Opens</span>
                      <input
                        type="time"
                        className="st-input"
                        value={(hours ?? DEFAULT_BUSINESS_HOURS).start}
                        onChange={(e) => patchHours({ start: e.target.value })}
                      />
                    </label>
                    <label className="st-time">
                      <span className="st-label-sm">Closes</span>
                      <input
                        type="time"
                        className="st-input"
                        value={(hours ?? DEFAULT_BUSINESS_HOURS).end}
                        onChange={(e) => patchHours({ end: e.target.value })}
                      />
                    </label>
                  </div>

                  <label className="st-time st-time--full">
                    <span className="st-label-sm">Timezone</span>
                    <select
                      className="st-input"
                      value={config.timezone}
                      onChange={(e) => patch({ timezone: e.target.value })}
                    >
                      {zones.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </label>

                  <p className="st-help">
                    Hours are wall-clock time in the zone above, not on the
                    server — daylight saving is handled for you. Closing time is
                    exclusive: 17:30 means the last minute inside hours is 17:29.
                  </p>
                </fieldset>

                <p className="st-status" role="status">
                  <span className="st-dot" data-on={scheduleNow.allowed} aria-hidden />
                  Right now it is <b>{clock}</b> in {config.timezone} —{" "}
                  {inHoursNow ? "inside" : "outside"} business hours, so an
                  enquiry arriving this second would{" "}
                  <b>{scheduleNow.allowed ? "get" : "not get"}</b> an auto-reply.
                </p>
              </>
            )}
          </section>

          <section className="st-card">
            <h2 className="st-card-title">Message</h2>

            <div className="st-tokens">
              <span className="st-tokens-label">Insert:</span>
              {MERGE_TOKENS.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className="st-chip"
                  title={t.hint}
                  onClick={() => insertToken(t.token)}
                >
                  {t.token}
                </button>
              ))}
            </div>

            <label className="st-field">
              <span className="st-label">Subject</span>
              <input
                ref={subjectRef}
                className="st-input"
                value={config.subject}
                maxLength={200}
                onFocus={() => (lastFocused.current = "subject")}
                onChange={(e) => patch({ subject: e.target.value })}
              />
            </label>

            <label className="st-field">
              <span className="st-label">Message</span>
              <textarea
                ref={bodyRef}
                className="st-textarea"
                rows={10}
                maxLength={5000}
                value={config.body}
                onFocus={() => (lastFocused.current = "body")}
                onChange={(e) => patch({ body: e.target.value })}
              />
            </label>

            <label className="st-field">
              <span className="st-label">
                Out-of-hours message <span className="st-optional">optional</span>
              </span>
              <textarea
                ref={oohRef}
                className="st-textarea"
                rows={7}
                maxLength={5000}
                placeholder="Leave empty to use the same message at all hours."
                value={config.outOfHoursBody ?? ""}
                onFocus={() => (lastFocused.current = "outOfHoursBody")}
                onChange={(e) =>
                  patch({ outOfHoursBody: e.target.value || null })
                }
              />
              {!config.outOfHoursBody?.trim() && (
                <button
                  type="button"
                  className="st-linkbtn"
                  onClick={() => patch({ outOfHoursBody: DEFAULT_OUT_OF_HOURS_BODY })}
                >
                  Use a suggested out-of-hours message
                </button>
              )}
            </label>
          </section>

          <section className="st-card">
            <div className="st-toggle-row">
              <div>
                <h2 className="st-card-title">Don&rsquo;t talk over a teammate</h2>
                <p className="st-card-sub">
                  Skip the acknowledgement if someone has already replied to the
                  ticket. This is enforced whatever this switch says — we
                  can&rsquo;t tell our own acknowledgement from an agent&rsquo;s
                  reply without a column that marks it, so any existing outbound
                  message suppresses the send.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.skipIfTeammateReplied}
                aria-label="Skip if a teammate already replied"
                className="st-switch"
                data-on={config.skipIfTeammateReplied}
                onClick={() =>
                  patch({ skipIfTeammateReplied: !config.skipIfTeammateReplied })
                }
              >
                <span className="st-switch-knob" aria-hidden />
              </button>
            </div>
          </section>
        </div>

        {/* ── Right: live preview ────────────────────────────── */}
        <div className="st-col">
          <section className="st-card st-preview-card">
            <div className="st-preview-head">
              <h2 className="st-card-title">Live preview</h2>
              <p className="st-card-sub">Exactly what the customer receives.</p>
            </div>

            <div className="st-preview-controls" role="group" aria-label="Preview options">
              <button
                type="button"
                className="st-chip"
                data-on={previewNamed}
                aria-pressed={previewNamed}
                onClick={() => setPreviewNamed(true)}
              >
                Name known
              </button>
              <button
                type="button"
                className="st-chip"
                data-on={!previewNamed}
                aria-pressed={!previewNamed}
                onClick={() => setPreviewNamed(false)}
              >
                No name
              </button>
              {config.outOfHoursBody?.trim() && (
                <button
                  type="button"
                  className="st-chip"
                  data-on={previewOutOfHours}
                  aria-pressed={previewOutOfHours}
                  onClick={() => setPreviewOutOfHours((v) => !v)}
                >
                  Out of hours
                </button>
              )}
            </div>

            <div className="st-email">
              <div className="st-email-head">
                <div className="st-email-row">
                  <span className="st-email-key">From</span>
                  <span className="st-email-val">{workspaceName}</span>
                </div>
                <div className="st-email-row">
                  <span className="st-email-key">To</span>
                  <span className="st-email-val">
                    {previewNamed ? "Alex Fenton " : ""}
                    &lt;alex@example.com&gt;
                  </span>
                </div>
                <div className="st-email-row">
                  <span className="st-email-key">Subject</span>
                  <span className="st-email-val st-email-subject">
                    {previewSubject || "(no subject)"}
                  </span>
                </div>
              </div>
              <div className="st-email-body">{previewBody}</div>
              <p className="st-email-foot">
                Sent with <code>Auto-Submitted: auto-replied</code> so other
                autoresponders don&rsquo;t answer it back. Replies thread into
                the same ticket.
              </p>
            </div>

            <dl className="st-summary">
              <div className="st-summary-row">
                <dt>Status</dt>
                <dd>{config.enabled ? "On" : "Off"}</dd>
              </div>
              <div className="st-summary-row">
                <dt>Timing</dt>
                <dd>{DELAY_LABELS[config.delay]}</dd>
              </div>
              <div className="st-summary-row">
                <dt>Schedule</dt>
                <dd>{SCHEDULE_LABELS[config.scheduleMode]}</dd>
              </div>
              <div className="st-summary-row">
                <dt>Hours</dt>
                <dd>{describeBusinessHours(hours, config.timezone)}</dd>
              </div>
            </dl>
          </section>

          <section className="st-card st-guards">
            <h2 className="st-card-title">Never sent to</h2>
            <ul className="st-list">
              <li>Our own sending, inbound or per-ticket reply addresses.</li>
              <li>
                <code>noreply@</code>, <code>mailer-daemon@</code>,{" "}
                <code>postmaster@</code> and other role or bounce addresses.
              </li>
              <li>
                Mail carrying <code>Auto-Submitted</code>, <code>Precedence: bulk</code>{" "}
                or any <code>List-*</code> header — mailing lists and other
                autoresponders.
              </li>
              <li>A ticket that already has any outbound message.</li>
              <li>
                The same address more than once in ten minutes, or three times an
                hour.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
