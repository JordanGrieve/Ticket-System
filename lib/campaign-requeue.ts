import type { CampaignStatus } from "@/db/schema";

/**
 * Putting a wholly-failed campaign back in the queue.
 *
 * ── THE HOLE THIS CLOSES ──
 * A recipient whose send fails goes to `failed`, and nothing in the product
 * could ever move it back. docs/NEWSLETTER.md says so in its own warning:
 * "Open Door Bakery has one confirmed subscriber; in the sandbox that send is
 * rejected, the row is written `failed`, the campaign is marked `sent`, and
 * nothing in the product can re-queue it."
 *
 * That is the same shape of trap `canAbortSend` was written to fix — a state
 * the product can reach and cannot leave — except here the cost is not a stuck
 * row, it is a spent subscriber. With a list of one, a single mistimed send
 * ends the possibility of the campaign until somebody re-subscribes.
 *
 * ── THE DANGER, AND WHY THIS DESIGN REMOVES IT RATHER THAN WARNING ABOUT IT ──
 * The obvious version of this feature — "retry the failed ones" — can send
 * somebody a second copy. Claim-before-send marks a row `sent` BEFORE the
 * provider call, so a row that is `sent` may or may not have arrived, and a
 * row that is `failed` sits next to rows that definitely did. Re-queueing
 * inside a partly-delivered campaign is a coin toss with somebody else's
 * inbox, and no amount of confirmation copy makes that safe.
 *
 * So it is not offered there. Re-queueing is permitted ONLY when NOBODY was
 * reached: no row was ever handed to the provider, and none is still in
 * flight. In that state a second attempt cannot be a second copy, because
 * there was never a first. The risk is removed by the precondition rather than
 * delegated to whoever is reading the dialog at the time.
 *
 * That is deliberately narrow. It covers precisely the case that motivated it
 * — a send that failed wholesale for one systemic reason, a rejected sandbox
 * identity, a missing credential, a misconfigured sender — and refuses the
 * ambiguous middle entirely.
 *
 * Pure: no database, no clock. The IO half is requeueFailedRecipients in
 * lib/campaign-send.ts.
 */

export type RequeueCounts = {
  /** Rows never claimed. Any of these means the send is not finished. */
  queued: number;
  /**
   * Rows handed to the provider: sent, delivered, bounced, complained. This
   * number being zero is the entire safety property — see above.
   */
  reached: number;
  /** Rows that failed. There must be at least one, or there is nothing to do. */
  failed: number;
};

export type RequeueVerdict =
  | { ok: true; count: number }
  | { ok: false; reason: RequeueRefusal };

export type RequeueRefusal =
  /** Still running, or still armed. Nothing to re-queue yet. */
  | "not_finished"
  /** Somebody was reached. Re-queueing could send a second copy. */
  | "partially_delivered"
  /** Nothing failed, so there is nothing to put back. */
  | "nothing_failed";

/**
 * May this campaign's failed recipients go back in the queue?
 *
 * Terminal statuses only. `sending` is `canAbortSend`'s edge and a campaign
 * mid-flight has rows whose fate is genuinely unknown; `draft` and `scheduled`
 * have nothing to retry.
 */
export function canRequeueFailed(
  status: CampaignStatus,
  counts: RequeueCounts,
): RequeueVerdict {
  if (status !== "sent" && status !== "failed") {
    return { ok: false, reason: "not_finished" };
  }
  // A queued row means the sweep has not finished with this campaign, whatever
  // the status column says. Belt and braces: settleCampaign should have left
  // none, and if one is here the status is the thing that is wrong.
  if (counts.queued > 0) return { ok: false, reason: "not_finished" };
  if (counts.reached > 0) return { ok: false, reason: "partially_delivered" };
  if (counts.failed < 1) return { ok: false, reason: "nothing_failed" };
  return { ok: true, count: counts.failed };
}

/**
 * What to tell somebody, in their words rather than the column's.
 *
 * The refusal that matters is `partially_delivered`, and it says what the
 * product will NOT do and why — somebody who has just watched most of a send
 * fail will otherwise reasonably assume the button is broken.
 */
export function describeRequeue(verdict: RequeueVerdict): string {
  if (verdict.ok) {
    return verdict.count === 1
      ? "Nobody received this. The one recipient can go back in the queue and the campaign returns to draft."
      : `Nobody received this. All ${verdict.count.toLocaleString()} recipients can go back in the queue and the campaign returns to draft.`;
  }
  switch (verdict.reason) {
    case "not_finished":
      return "This campaign has not finished sending, so there is nothing to put back yet.";
    case "partially_delivered":
      return "Some of these messages reached people, so the failed ones cannot be re-queued — a second attempt could send somebody a duplicate. Build a new campaign for the people who missed out.";
    case "nothing_failed":
      return "Nothing failed, so there is nothing to re-queue.";
  }
}
