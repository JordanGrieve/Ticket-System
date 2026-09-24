"use client";

import { useState } from "react";
import type { CampaignStatus, RecipientStatus } from "@/db/schema";
import type { CampaignHealth } from "@/lib/campaign-health";
import { canRequeueFailed, describeRequeue } from "@/lib/campaign-requeue";
import {
  canAbortSend,
  canCancelSchedule,
  canSchedule,
  describeDrain,
} from "@/lib/campaign-schedule";
import {
  describeWhen,
  primaryLabel,
  scheduledSummary,
  type ReadinessStep,
  type WhenMode,
} from "@/lib/campaign-readiness";
import { AbortPanel } from "./AbortPanel";
import ReadinessChecklist from "./ReadinessChecklist";
import {
  STATUS_LABELS,
  type AbortState,
  type ArmTarget,
  type RequeueState,
  type ScheduleState,
} from "./composer-model";

type TestSendState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; transmitted: boolean }
  | { kind: "error"; message: string };

/**
 * ── The draft ⇄ scheduled edge ──
 *
 * The "Schedule this campaign" card: why it is not moving, and then exactly
 * one of stop / put back / cancel / the checklist and the send controls.
 * Every request that changes the campaign is the composer's; the one this
 * panel makes itself is the test send, which changes nothing.
 */
export default function SchedulePanel({
  savedId,
  status,
  dirty,
  recipientCount,
  scheduledAtIso,
  recipientsPerSweep,
  health,
  recipients,
  abort,
  onAbort,
  requeue,
  onRequeue,
  schedule,
  onScheduleReset,
  onArm,
  onCancelSchedule,
  steps,
  ready,
  onFix,
  canSendLegally,
  viewerEmail,
}: {
  savedId: number | null;
  status: CampaignStatus;
  dirty: boolean;
  recipientCount: number;
  scheduledAtIso: string | null;
  recipientsPerSweep: number;
  health: CampaignHealth | null;
  recipients: Record<RecipientStatus, number> | null;
  abort: AbortState;
  onAbort: () => void;
  requeue: RequeueState;
  onRequeue: () => void;
  schedule: ScheduleState;
  /** Any change to "when" clears the last schedule result. */
  onScheduleReset: () => void;
  onArm: (target: ArmTarget) => void;
  onCancelSchedule: () => void;
  steps: ReadinessStep[];
  ready: boolean;
  onFix: (fix: ReadinessStep["fix"]) => void;
  canSendLegally: boolean;
  viewerEmail: string;
}) {
  const [whenMode, setWhenMode] = useState<WhenMode>("now");
  /** Local wall clock, two fields; lib/campaign-readiness turns them into an instant. */
  const [whenDate, setWhenDate] = useState("");
  const [whenTime, setWhenTime] = useState("");
  /**
   * The test send. Separate state from `schedule` because it is not part of
   * the draft→scheduled edge at all — it writes nothing and changes no status,
   * so it must not be able to put the schedule UI into a working state.
   */
  const [testSend, setTestSend] = useState<TestSendState>({ kind: "idle" });

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when =
    whenMode === "later" ? describeWhen(whenDate, whenTime, new Date(), timeZone) : null;

  /*
    Whether this finished campaign can go back in the queue.

    Null until the recipient counts have loaded — the answer depends entirely
    on them, and defaulting to "no" would hide the control from the person who
    needs it for as long as the numbers take to arrive.
  */
  const requeueVerdict =
    recipients === null
      ? null
      : canRequeueFailed(status, {
          queued: recipients.queued,
          reached:
            recipients.sent +
            recipients.delivered +
            recipients.bounced +
            recipients.complained,
          failed: recipients.failed,
        });

  /**
   * Resolve the picked time with a fresh `now` at the moment of pressing, so
   * a time that passed while the form sat open is refused, not sent.
   */
  function arm() {
    if (whenMode === "later") {
      const w = describeWhen(whenDate, whenTime, new Date(), timeZone);
      onArm(w.ok ? { ok: true, iso: w.iso } : { ok: false, text: w.text });
      return;
    }
    onArm({ ok: true, iso: null });
  }

  /**
   * Send this draft to the signed-in user's own address, once.
   *
   * Writes nothing and transitions nothing — see the route header. The
   * recipient is fixed server-side to the session's address; there is no
   * parameter here to change it, and adding one would turn this into a relay.
   */
  async function sendTestToMyself() {
    if (savedId === null || testSend.kind === "working") return;
    setTestSend({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/test-send`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        transmitted?: boolean;
      };
      if (!res.ok) {
        setTestSend({
          kind: "error",
          message: data.error ?? "That didn’t send.",
        });
        return;
      }
      setTestSend({ kind: "ok", transmitted: data.transmitted === true });
    } catch {
      setTestSend({ kind: "error", message: "That didn’t send." });
    }
  }

  return (
    <section className="nl-card">
      <h3 className="nl-card-title">Schedule this campaign</h3>

      {recipientCount > 0 && (
        <p className="nl-note">
          {describeDrain(recipientCount, recipientsPerSweep)}
        </p>
      )}

      {/*
        Why this campaign is not moving. Rendered only when there is
        something to say — a healthy campaign gets no panel, because a
        reassurance box on every screen is noise that trains people to
        skip the one that matters.

        Hoisted OUT of the arming form below, where it used to live.
        "stalled" is by definition a `sending` campaign, and `sending`
        is the branch that now offers Stop — so leaving the diagnosis
        inside the branch that renders the arming form would mean the
        explanation vanished from precisely the screen a person reaches
        when they are deciding whether to stop.
      */}
      {health && health.blockers.length > 0 && (
        <div
          className={health.state === "stalled" ? "nl-warn" : "nl-note"}
          role="status"
        >
          <b>
            {health.state === "stalled"
              ? `This campaign is stuck — ${health.remaining} ${
                  health.remaining === 1 ? "person has" : "people have"
                } not been sent to.`
              : "Before this can send:"}
          </b>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {health.blockers.map((b) => (
              <li key={b.code} style={{ marginBottom: 4 }}>
                {b.message}
                {b.operatorOnly && (
                  <>
                    {" "}
                    <em>We&rsquo;ve been told about this one.</em>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        ── THREE BRANCHES, NOT TWO ──

        `sending` is checked FIRST. It used to fall through to the
        arming form, which rendered a "When" fieldset and a Schedule
        button that were disabled and pointless — the screen's answer to
        a wedged campaign was a greyed-out control for a transition that
        had already happened. The only action that applies to a campaign
        mid-send is stopping it, so that is the only action it shows.
      */}
      {canAbortSend(status) ? (
        <AbortPanel
          state={abort}
          recipients={recipients}
          stalled={health?.state === "stalled"}
          onAbort={onAbort}
        />
      ) : requeueVerdict?.ok ? (
        /*
          A finished campaign that reached NOBODY. Until this existed
          the only exit was building the whole thing again, and with a
          one-person list the person was spent — docs/NEWSLETTER.md
          warned about exactly that.

          Offered only in the all-failed case. The partly-delivered one
          is not a confirmation away, it is absent, because a retry
          there could put a second copy in a real inbox.
        */
        <>
          <p className="nl-note nl-note--warn" role="status">
            This campaign finished and <b>nobody received it</b>. Every
            attempt failed, so nothing was delivered and nobody was
            emailed twice.
          </p>
          <div className="nl-queue-row">
            <button
              type="button"
              className="nl-secondary"
              onClick={onRequeue}
              disabled={requeue.kind === "working"}
            >
              {requeue.kind === "working"
                ? "Putting them back…"
                : "Put the recipients back and edit"}
            </button>
            <span className="nl-help">
              {describeRequeue(requeueVerdict)} Fix whatever stopped it
              first — a failure this complete is usually one cause, not
              many.
            </span>
          </div>
          {requeue.kind === "error" && (
            <p className="nl-error" role="alert">
              {requeue.message}
            </p>
          )}
        </>
      ) : status === "scheduled" ? (
        /*
          Armed. One status row — when, and for how many — with the
          way back beside it. The paragraphs about sweeps and log
          lines that used to sit here explained the machinery; the
          row states the fact.
        */
        <div className="nl-status-row" role="status">
          <span className="nl-status-dot" aria-hidden />
          <span className="nl-status-text">
            {scheduledSummary(scheduledAtIso, recipientCount, timeZone)}
          </span>
          <button
            type="button"
            className="nl-linkbtn"
            onClick={onCancelSchedule}
            disabled={!canCancelSchedule(status) || schedule.kind === "working"}
          >
            {schedule.kind === "working" ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      ) : (
        <>
          <ReadinessChecklist steps={steps} onFix={onFix} />

          <fieldset className="nl-field">
            <legend className="nl-label">Send</legend>
            <div className="nl-seg" role="group" aria-label="When to send">
              <button
                type="button"
                className="nl-seg-btn"
                data-on={whenMode === "now"}
                aria-pressed={whenMode === "now"}
                onClick={() => {
                  setWhenMode("now");
                  onScheduleReset();
                }}
              >
                Now
              </button>
              <button
                type="button"
                className="nl-seg-btn"
                data-on={whenMode === "later"}
                aria-pressed={whenMode === "later"}
                onClick={() => {
                  setWhenMode("later");
                  onScheduleReset();
                }}
              >
                Later
              </button>
            </div>
            {whenMode === "later" && (
              <>
                <div className="nl-when-grid">
                  <label className="nl-field nl-field--tight">
                    <span className="nl-label">Date</span>
                    <input
                      className="nl-input"
                      type="date"
                      value={whenDate}
                      min={todayLocal()}
                      onChange={(e) => {
                        setWhenDate(e.target.value);
                        onScheduleReset();
                      }}
                    />
                  </label>
                  <label className="nl-field nl-field--tight">
                    <span className="nl-label">Time</span>
                    <input
                      className="nl-input"
                      type="time"
                      value={whenTime}
                      onChange={(e) => {
                        setWhenTime(e.target.value);
                        onScheduleReset();
                      }}
                    />
                  </label>
                </div>
                <p className="nl-when-readout" data-ok={when?.ok || undefined}>
                  {when?.text}
                </p>
              </>
            )}
          </fieldset>

          <div className="nl-send-row">
            <button
              type="button"
              className="nl-queue nl-send"
              onClick={arm}
              disabled={
                !ready ||
                (whenMode === "later" && !(when && when.ok)) ||
                schedule.kind === "working"
              }
            >
              {schedule.kind === "working"
                ? "Scheduling…"
                : primaryLabel(whenMode, when)}
            </button>
            {/*
              The test send, beside the primary rather than above it:
              it is the thing to press first, and it is the only
              action here that produces a real message without
              committing anything. It needs a saved draft and the
              postal address, not the whole list.
            */}
            {/*
              A secondary BUTTON, not a link-button.

              It sat beside "Save" as underlined text, which reads as a
              footnote rather than the other half of a pair of choices —
              and this is the action that shows a client what their
              subscribers will actually receive, so it is the one thing
              on the screen most worth pressing before the real send.
              .stg-button--secondary is new (app/globals.css); the style
              guide had described it for days without anyone writing it.
            */}
            <button
              type="button"
              className="stg-button stg-button--secondary"
              onClick={sendTestToMyself}
              disabled={
                savedId === null ||
                dirty ||
                !canSendLegally ||
                testSend.kind === "working"
              }
            >
              {testSend.kind === "working" ? "Sending…" : "Send me a test first"}
            </button>
          </div>

          {testSend.kind === "ok" && (
            <p className="nl-note" role="status">
              {testSend.transmitted ? (
                <>
                  Sent to <b>{viewerEmail}</b>. Check the footer carries
                  your postal address and that the unsubscribe link is
                  there — the link in a test belongs to nobody, so
                  pressing it does nothing.
                </>
              ) : (
                <>
                  <b>Nothing was transmitted.</b> Delivery is still in
                  log-only mode, so this was written to the server log
                  instead of sent. Set{" "}
                  <code>CAMPAIGN_DELIVERY_MODE=resend</code> to send for
                  real.
                </>
              )}
            </p>
          )}
          {testSend.kind === "error" && (
            <p className="nl-error" role="status">
              {testSend.message}
            </p>
          )}
          {savedId !== null && !canSchedule(status) && (
            <p className="nl-help">
              This campaign is{" "}
              {STATUS_LABELS[status].toLowerCase()} and can’t be
              scheduled again.
            </p>
          )}
        </>
      )}

      {schedule.kind === "error" && (
        <p className="nl-error" role="alert">
          {schedule.message}
        </p>
      )}
      {schedule.kind === "cancelled" && (
        <p className="nl-note" role="status">
          Schedule cancelled. This campaign is a draft again and its
          queued recipients are untouched.
        </p>
      )}
      {/*
        What "Send now" actually did, from the server's own count.

        Reported rather than assumed: the request sends one pass and
        the sweep drains the rest, so the honest answer after pressing
        the button is a number, not "sent". Saying "sent" over a list
        that has three hundred left would be the screen lying about the
        one thing somebody is watching it for.
      */}
      {schedule.kind === "armed" && schedule.sent && (
        <p className="nl-note" role="status">
          {schedule.sent.delivered > 0
            ? `${schedule.sent.delivered.toLocaleString()} sent just now.`
            : "Nothing went out in that first pass."}{" "}
          {schedule.sent.failed > 0 &&
            `${schedule.sent.failed.toLocaleString()} failed. `}
          {schedule.sent.more
            ? "The rest follow on the next sweep, about once an hour."
            : schedule.sent.completed > 0
              ? "That was everybody — this campaign is done."
              : ""}
        </p>
      )}
    </section>
  );
}

/** Today as a `date` input value, in local time, for the field's `min`. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
