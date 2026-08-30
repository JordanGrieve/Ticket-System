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
  planDeferral,
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

/** "Monday at 09:00", in the workspace's own zone — the clock its staff read. */
function describeMoment(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("weekday")} at ${get("hour")}:${get("minute")}`;
  } catch {
    return "the next time you're open";
  }
}

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

  // Mirrors the send path's choice, including the mode in which the
  // out-of-hours copy is never reached — see `outOfHoursBodyUsed` below.
  const previewBodyTemplate =
    previewOutOfHours &&
    config.scheduleMode !== "business_hours" &&
    config.outOfHoursBody?.trim()
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

  // The same function the send path calls. If this says a held reply goes out
  // on Monday morning, that is because the sweep will compute exactly this.
  // Null while the workspace is OPEN (there is nothing to hold), so it cannot
  // stand in for "does this schedule defer at all" — that is `canDefer`.
  const deferUntil = planDeferral(config, now);
  const canDefer =
    config.scheduleMode === "business_hours" &&
    scheduleNow.reason !== "no_window_configured";
  // What actually happens to an enquiry arriving this second.
  const rightNow: "sends" | "held" | "dropped" = scheduleNow.allowed
    ? "sends"
    : deferUntil
      ? "held"
      : "dropped";

  const hoursNeeded =
    config.scheduleMode !== "always" || !!config.outOfHoursBody?.trim();

  // In "During business hours only" the acknowledgement is never composed
  // while the workspace is closed — a held one goes out after opening, in
  // hours — so the out-of-hours copy below is dead text in that mode. Saying so
  // is cheaper than letting someone write a message that is never sent.
  const outOfHoursBodyUsed = config.scheduleMode !== "business_hours";

  return (
    <div className="st-wrap">
      <header className="st-head">
        <div className="st-head-text">
          <h1 className="st-title">Auto-reply</h1>
          <p className="st-sub">
            Send an acknowledgement so people know their message landed. It goes
            out once per enquiry, never to a robot, and never on top of a
            teammate&rsquo;s reply — immediately, or held until you open if
            you&rsquo;ve limited it to business hours.
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
                          : "Delayed sending isn't built. Held out-of-hours replies use a queue, but nothing yet puts a fixed delay on an in-hours one."
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
                Only immediate sending is available. A fixed delay isn&rsquo;t
                wired up: out-of-hours acknowledgements are now held in a queue
                and released when you open, but nothing yet holds an in-hours
                one back by five minutes or an hour. Offering the option would
                mean switching auto-replies on and silently sending nothing.
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
              <p className="st-help">
                {config.scheduleMode === "business_hours" && (
                  <>
                    Enquiries that arrive while you&rsquo;re closed are{" "}
                    <b>held, not dropped</b>. The acknowledgement is sent
                    shortly after you next open — usually within a few minutes
                    of opening time, not on the dot. Nothing is held for longer
                    than half a day past its due time; if it goes stale that
                    long it is dropped rather than sent late.
                  </>
                )}
                {config.scheduleMode === "out_of_hours" && (
                  <>
                    Only enquiries arriving while you&rsquo;re <b>closed</b> get
                    an acknowledgement. One that arrives while you&rsquo;re open
                    gets nothing and is <b>not</b> held for later — a
                    &ldquo;we&rsquo;re closed&rdquo; message sent hours after
                    one of your team has already replied would be worse than
                    silence.
                  </>
                )}
                {config.scheduleMode === "always" && (
                  <>
                    Every enquiry is acknowledged as it arrives, at any hour.
                    Set an out-of-hours message below if the wording should
                    change when you&rsquo;re closed.
                  </>
                )}
              </p>
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
                  <span
                    className="st-dot"
                    data-on={rightNow !== "dropped"}
                    aria-hidden
                  />
                  Right now it is <b>{clock}</b> in {config.timezone} —{" "}
                  {inHoursNow ? "inside" : "outside"} business hours, so an
                  enquiry arriving this second would{" "}
                  {rightNow === "sends" && <b>be acknowledged straight away</b>}
                  {rightNow === "held" && deferUntil && (
                    <>
                      <b>be held</b> and acknowledged shortly after{" "}
                      <b>{describeMoment(deferUntil, config.timezone)}</b>
                    </>
                  )}
                  {rightNow === "dropped" && (
                    <b>never be acknowledged at all</b>
                  )}
                  .
                </p>

                {rightNow === "dropped" &&
                  config.scheduleMode === "business_hours" && (
                    <p className="st-help st-help--warn">
                      There are no open days set, so there is no next opening to
                      hold an acknowledgement for. Every enquiry arriving while
                      this is the case is dropped silently — the ticket is still
                      created, but the customer hears nothing. Pick at least one
                      day above, or switch the schedule to
                      &ldquo;Always&rdquo;.
                    </p>
                  )}
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
              {!outOfHoursBodyUsed ? (
                <p className="st-help st-help--warn">
                  Not used with this schedule. On &ldquo;During business hours
                  only&rdquo; nothing is ever sent while you&rsquo;re closed —
                  an enquiry from last night is acknowledged after you open, so
                  it gets the message above, not this one. It applies on
                  &ldquo;Always&rdquo; and on &ldquo;Outside business hours
                  only&rdquo;.
                </p>
              ) : (
                !config.outOfHoursBody?.trim() && (
                  <button
                    type="button"
                    className="st-linkbtn"
                    onClick={() =>
                      patch({ outOfHoursBody: DEFAULT_OUT_OF_HOURS_BODY })
                    }
                  >
                    Use a suggested out-of-hours message
                  </button>
                )
              )}
            </label>
          </section>

          <section className="st-card">
            <div className="st-toggle-row">
              <div>
                <h2 className="st-card-title">Don&rsquo;t talk over a teammate</h2>
                <p className="st-card-sub">
                  Skip the acknowledgement if one of your team has already
                  replied to the enquiry. An enquiry never gets acknowledged
                  twice either way — that part is always on.
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
          {/*
            ── IN THE LEFT COLUMN SO THE PREVIEW CAN STICK ──
            The right column's preview card is position:sticky. A sticky
            element keeps its space in the flow and then translates down as the
            page scrolls, so anything below it in the SAME column gets covered
            — this card was being scrolled under the pinned preview.

            Sticky only behaves when it is the last thing in its column. Moving
            this here makes that true, rather than giving up the sticky
            preview, which is the whole point of the split: you edit the
            message on the left and watch it change on the right.
          */}
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
            <p className="st-help">
              A held out-of-hours acknowledgement is checked against every one
              of these again at the moment it goes out — not when it was held.
              If a teammate answered overnight, or the sender turns out to be
              another robot, it is dropped in the morning rather than sent.
            </p>
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
              {outOfHoursBodyUsed && config.outOfHoursBody?.trim() && (
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
              <div className="st-summary-row">
                <dt>While closed</dt>
                <dd>
                  {config.scheduleMode === "always"
                    ? "Acknowledged straight away"
                    : config.scheduleMode === "out_of_hours"
                      ? "Acknowledged straight away (in hours: nothing)"
                      : canDefer
                        ? "Held until you open"
                        : "Nothing sent, ever"}
                </dd>
              </div>
            </dl>
          </section>

        </div>
      </div>
    </div>
  );
}
