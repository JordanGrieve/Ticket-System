"use client";

import { useEffect, useRef, useState } from "react";
import type { RecipientStatus } from "@/db/schema";
import { describeAbort, SWEEP_CADENCE } from "@/lib/campaign-schedule";
import { useDismiss } from "@/lib/use-dismiss";
import type { AbortState } from "./composer-model";

// ── Stopping a send in progress ──────────────────────────────────

/**
 * The only control a `sending` campaign gets.
 *
 * ── IT IS NOT STYLED AS "CANCEL SCHEDULE" ──
 *
 * Different verb, different className, and the numbers are on screen BEFORE the
 * confirm rather than only inside it. Cancelling a schedule costs nothing and
 * can be redone in a second; this ends a campaign part way through a real
 * audience and cannot be redone at all. A person who has cancelled a schedule
 * twice this week should not be able to press this on the same reflex.
 *
 * The counts are shown even when nothing is wrong, because "this is fine, it is
 * just working through the queue" and "this will never move again" are the two
 * things a person is choosing between, and only one of them is worth stopping.
 */
export function AbortPanel({
  state,
  recipients,
  stalled,
  onAbort,
}: {
  state: AbortState;
  recipients: Record<RecipientStatus, number> | null;
  stalled: boolean;
  /** Called once the person has confirmed. The panel asks; the caller acts. */
  onAbort: () => void;
}) {
  const alreadySent =
    recipients === null
      ? null
      : recipients.sent +
        recipients.delivered +
        recipients.bounced +
        recipients.complained;

  /*
    ── THE QUESTION, IN THE PANEL ──
    This was a window.confirm until 8 Sep 2026. It qualified for the in-page
    pattern on every count — one call site, its own button, asynchronous —
    and it is the most consequential
    question in the product: it can strand part of a live audience. The
    numbers a person is deciding on belong beside the button they are about to
    press, not in the operating system's grey box.

    The text is still describeAbort's, so the number of people already mailed
    and still queued is the same wording the tests pin, split into paragraphs
    rather than joined with newlines a <p> would collapse. When the counts
    could not be read the question says so, because "we do not know how many"
    is a fact the person needs before pressing Stop.
  */
  const [confirming, setConfirming] = useState(false);
  const stopBtnRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useDismiss(confirming, () => {
    returnFocus.current = true;
    setConfirming(false);
  });

  useEffect(() => {
    if (confirming || !returnFocus.current) return;
    returnFocus.current = false;
    stopBtnRef.current?.focus();
  }, [confirming]);

  const question = (
    recipients !== null && alreadySent !== null
      ? describeAbort({ queued: recipients.queued, alreadySent })
      : "Stop this campaign for good?\n\nWe couldn’t read how many people have already been sent this, so this may stop a campaign that is part way through a live audience. Anyone already mailed cannot be un-mailed.\n\nThis cannot be undone. The campaign is marked Failed and can’t be edited, re-scheduled or sent again."
  ).split("\n\n");

  return (
    <>
      <p className="nl-note nl-note--warn" role="status">
        This campaign is <b>sending</b>. It can’t be edited, re-scheduled, or
        have its recipients changed — those rows are already being worked
        through.{" "}
        {stalled
          ? `It is also not moving, and it will keep re-entering the sweep, which runs ${SWEEP_CADENCE}, until something changes.`
          : "The sweep is working through it a batch at a time."}
      </p>

      {recipients !== null && alreadySent !== null && (
        <ul className="nl-facts">
          <li className="nl-fact nl-fact--no">
            <b>
              {alreadySent.toLocaleString()}{" "}
              {alreadySent === 1 ? "person has" : "people have"} already been
              sent this.
            </b>{" "}
            Those messages were handed over before you got here and cannot be
            recalled. Stopping does not touch them, and they stay on the report
            as mailed.
          </li>
          <li className="nl-fact nl-fact--yes">
            <b>
              {recipients.queued.toLocaleString()}{" "}
              {recipients.queued === 1 ? "person is" : "people are"} still
              queued.
            </b>{" "}
            Stopping is the only thing that reaches them — they would never be
            sent this campaign.
          </li>
        </ul>
      )}

      {confirming && (
        <div
          className="nl-confirm"
          role="alertdialog"
          aria-label="Stop this campaign"
          aria-describedby="nl-abort-q"
        >
          <div id="nl-abort-q">
            {question.map((para, i) => (
              <p className="nl-confirm-q" key={i}>
                {i === 0 ? <b>{para}</b> : para}
              </p>
            ))}
          </div>
          <div className="nl-confirm-acts">
            {/* Cancel first and focused, for the reason the unqueue confirm
                gives — and it matters more here, because the other button
                cannot be undone. */}
            <button
              type="button"
              className="nl-confirm-btn"
              autoFocus
              disabled={state.kind === "working"}
              onClick={() => {
                returnFocus.current = true;
                setConfirming(false);
              }}
            >
              Keep sending
            </button>
            <button
              type="button"
              className="nl-confirm-btn nl-confirm-btn--danger"
              disabled={state.kind === "working"}
              onClick={() => {
                returnFocus.current = true;
                setConfirming(false);
                onAbort();
              }}
            >
              Stop it for good
            </button>
          </div>
        </div>
      )}

      <div className="nl-queue-row">
        <button
          ref={stopBtnRef}
          type="button"
          className="nl-danger"
          onClick={() => setConfirming(true)}
          disabled={state.kind === "working" || confirming}
          aria-expanded={confirming}
        >
          {state.kind === "working" ? "Stopping…" : "Stop this campaign"}
        </button>
        <span className="nl-help">
          Ends the campaign for good and marks it <b>Failed</b>.{" "}
          {alreadySent === 0 ? (
            /*
              Stopping BEFORE anybody was reached is recoverable, and saying
              otherwise would frighten somebody out of the safe choice. The
              requeue panel appears afterwards precisely because nothing was
              delivered — see lib/campaign-requeue.ts.
            */
            <>
              Nobody has been reached yet, so afterwards you can put the
              recipients back and return this to draft.
            </>
          ) : (
            <>
              There is no way to finish the send afterwards, and the people
              already mailed cannot be un-mailed.
            </>
          )}
        </span>
      </div>

      {state.kind === "error" && (
        <p className="nl-error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === "stopped" && (
        <p className="nl-note nl-note--warn" role="status">
          <b>Stopped.</b>{" "}
          {state.stopped === 0
            ? "Nobody was still queued, so nobody was cut off."
            : `${state.stopped.toLocaleString()} queued ${
                state.stopped === 1 ? "recipient" : "recipients"
              } will never be sent this campaign.`}{" "}
          {state.alreadySent === 0
            ? "Nobody had been sent it."
            : `${state.alreadySent.toLocaleString()} ${
                state.alreadySent === 1 ? "person" : "people"
              } had already been sent it, and that cannot be undone.`}{" "}
          The campaign is marked Failed and the sweep will not pick it up again.
        </p>
      )}
    </>
  );
}
