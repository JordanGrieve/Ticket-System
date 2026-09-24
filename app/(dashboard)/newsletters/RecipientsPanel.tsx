"use client";

import { useState } from "react";
import type { CampaignStatus } from "@/db/schema";
import { canDiscardRecipients } from "@/lib/campaign-schedule";
import type { QueueState } from "./composer-model";

/**
 * ── What queueing does, and does not do ──
 *
 * "Queue recipients" writes `campaign_recipients` rows; "Remove queued
 * recipients" deletes them again. The requests are the composer's, because
 * both change the draft's count and the diagnosis; this panel asks and reports.
 */
export default function RecipientsPanel({
  savedId,
  status,
  dirty,
  recipientCount,
  queue,
  chasing,
  onQueue,
  onDiscard,
}: {
  savedId: number | null;
  status: CampaignStatus;
  dirty: boolean;
  recipientCount: number;
  queue: QueueState;
  /** A readiness step is pointing at this card. */
  chasing: boolean;
  onQueue: () => void;
  onDiscard: () => void;
}) {
  /** The unqueue button has become its own "are you sure?" — see below. */
  const [confirmingUnqueue, setConfirmingUnqueue] = useState(false);

  return (
    <section className="nl-card" data-chasing={chasing || undefined}>
      <h3 className="nl-card-title" id="nl-recipients">Recipients</h3>

      <div className="nl-queue-row">
        <button
          type="button"
          className="nl-queue"
          onClick={onQueue}
          disabled={
            savedId === null ||
            status !== "draft" ||
            dirty ||
            queue.kind === "working"
          }
        >
          {queue.kind === "working" ? "Working…" : "Queue recipients"}
        </button>

        {/*
          The other half of the one-way door. Rendered whenever the
          campaign holds rows, not tucked behind a menu: the whole
          point is that somebody who has just queued the wrong list can
          see the way back without going looking for it.
        */}
        {confirmingUnqueue ? (
          /* The control becomes the question. The count is the whole
             point of asking — "remove 47 rows" is a different decision
             from "remove 4000". */
          <div
            className="nl-confirm"
            role="alertdialog"
            aria-label="Remove queued recipients"
            aria-describedby="nl-unqueue-q"
          >
            <p className="nl-confirm-q" id="nl-unqueue-q">
              {recipientCount > 0
                ? `Remove ${recipientCount.toLocaleString()} queued recipient ${
                    recipientCount === 1 ? "row" : "rows"
                  }?`
                : "Remove this campaign's queued recipients?"}{" "}
              The rows are deleted; you can queue the list again
              afterwards.
            </p>
            <div className="nl-confirm-acts">
              {/* Cancel first and focused: the button that was under
                  the pointer has just unmounted, so focus has to land
                  somewhere and the safe choice changes nothing. */}
              <button
                type="button"
                className="nl-confirm-btn"
                autoFocus
                onClick={() => setConfirmingUnqueue(false)}
              >
                Keep them
              </button>
              <button
                type="button"
                className="nl-confirm-btn nl-confirm-btn--danger"
                onClick={() => {
                  if (savedId === null || queue.kind === "working") return;
                  setConfirmingUnqueue(false);
                  onDiscard();
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="nl-unqueue"
            onClick={() => setConfirmingUnqueue(true)}
            disabled={
              savedId === null ||
              !canDiscardRecipients(status) ||
              recipientCount === 0 ||
              queue.kind === "working"
            }
          >
            Remove queued recipients
          </button>
        )}
      </div>

      {savedId === null && (
        <p className="nl-help">Create the draft first.</p>
      )}
      {savedId !== null && dirty && (
        <p className="nl-help">Save your changes first.</p>
      )}
      {savedId !== null && status === "scheduled" && (
        <p className="nl-help">
          This campaign is scheduled. Cancel the schedule below to
          change its recipients.
        </p>
      )}

      {queue.kind === "error" && (
        <p className="nl-error" role="alert">
          {queue.message}
        </p>
      )}
      {queue.kind === "done" && (
        <p className="nl-note" role="status">
          {queue.inserted === 0
            ? "Nothing new to queue — every eligible recipient already had a row."
            : `${queue.inserted.toLocaleString()} recipient ${
                queue.inserted === 1 ? "row" : "rows"
              } created.`}{" "}
          {/*
            This used to end "No email has been sent, and none will be
            — the scheduled sweep has no live sender configured." The
            first half is true of queueing always; the second was
            hardcoded, so it asserted that nothing would ever send even
            on a workspace whose sender IS configured. Whether mail can
            actually leave is diagnosed by lib/campaign-health.ts from
            the real environment and shown in the panel below — one
            answer, computed, rather than two, one of them a guess.
          */}
          {queue.total.toLocaleString()} in total, all sitting at
          “queued”. Queueing sends nothing by itself — scheduling is
          what starts it.
        </p>
      )}
      {queue.kind === "discarded" && (
        <p className="nl-note" role="status">
          {queue.deleted === 0
            ? "Nothing to remove — this campaign had no queued rows."
            : `${queue.deleted.toLocaleString()} queued ${
                queue.deleted === 1 ? "row" : "rows"
              } deleted.`}{" "}
          {queue.total.toLocaleString()} recipient{" "}
          {queue.total === 1 ? "row" : "rows"} left on this campaign.
        </p>
      )}
    </section>
  );
}
