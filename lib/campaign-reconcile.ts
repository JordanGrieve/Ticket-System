/**
 * Recipients that were claimed for sending and never recorded an outcome.
 *
 * Pure: no database, no clock of its own. The IO lives in lib/campaign-send.ts.
 *
 * ── WHAT THESE ROWS ARE ──
 * The send path claims a row before calling the provider:
 *
 *   UPDATE campaign_recipients SET status='sent', sent_at=now()
 *    WHERE id=$1 AND status='queued'
 *
 * then calls the provider, then writes provider_message_id. That order is
 * deliberate and correct for marketing mail: a crash between the claim and the
 * provider LOSES one email instead of mailing everybody twice.
 *
 * The residue is rows sitting at `sent` with provider_message_id NULL. Both
 * deliverers always return an id — SES returns the real one, and the log-only
 * deliverer returns a `not-sent-` prefixed synthetic id precisely so it does
 * not pollute this signal — so a NULL means the outcome was genuinely never
 * recorded.
 *
 * ── WHY NOTHING IS RE-QUEUED, EVER ──
 * A NULL id has two possible histories and no way to tell them apart:
 *
 *   a) we crashed before the provider call — the email was NOT sent
 *   b) the provider accepted it and we crashed before writing the id — it WAS
 *
 * There is no id to ask the provider about, so this cannot be resolved by
 * querying anything. It is not a reconciliation that has not been written yet;
 * it is a reconciliation that is not possible. Given that, re-queueing risks
 * mailing somebody a second time to fix a maybe, and duplicate marketing mail
 * costs complaints and sending reputation. Under-delivering costs one email.
 *
 * ── AND WHY THE STATUS IS NOT CHANGED EITHER ──
 * `failed` would assert the provider refused, which is not known. `delivered`
 * is set only by the provider webhook and would be a lie. `sent` already means
 * "dispatched", not "delivered" — the campaign report distinguishes them — so
 * leaving it is the least wrong of the available claims.
 *
 * What the sweep does instead is stamp the row with an explanation so it stops
 * looking like an ordinary send, and surface a count so a human learns the
 * campaign under-delivered. That is the whole honest scope of the thing.
 */

/** Written into campaign_recipients.error so a row explains itself later. */
export const UNCONFIRMED_ERROR =
  "No delivery confirmation was recorded. The send was claimed but the " +
  "provider never returned a message id, so we cannot show this was " +
  "delivered — and we do not re-send, because it may have been.";

/**
 * How long after the claim a missing id stops being "in flight".
 *
 * Generous on purpose. A provider call plus the follow-up write is seconds; an
 * hour is far past any timeout, retry or slow batch, so a row older than this
 * is not still being worked on by anybody. Too short and the sweep would
 * annotate rows a live batch is about to complete, which would put a scary
 * error on a perfectly good send.
 */
export const UNCONFIRMED_AFTER_MINUTES = 60;

export type UnconfirmedRow = {
  recipientId: number;
  campaignId: number;
  campaignName: string;
  workspaceId: number;
  workspaceName: string;
  /** When the row was claimed. */
  sentAt: Date;
};

export type UnconfirmedGroup = {
  campaignId: number;
  campaignName: string;
  workspaceId: number;
  workspaceName: string;
  count: number;
  /** The oldest claim in the group — how long this has been true. */
  oldestSentAt: Date;
};

/** Rows older than the threshold. `now` is passed in so this stays pure. */
export function isUnconfirmed(row: { sentAt: Date }, now: Date): boolean {
  return now.getTime() - row.sentAt.getTime() >= UNCONFIRMED_AFTER_MINUTES * 60_000;
}

/**
 * Group by campaign, because that is the unit somebody acts on.
 *
 * One alert per campaign saying "nine recipients have no confirmation" is
 * actionable. Nine alerts saying "recipient 4471 has no confirmation" is nine
 * copies of the same fact, and the reader learns less from all of them than
 * from the one.
 */
export function groupUnconfirmed(rows: UnconfirmedRow[]): UnconfirmedGroup[] {
  const byCampaign = new Map<number, UnconfirmedGroup>();

  for (const row of rows) {
    const existing = byCampaign.get(row.campaignId);
    if (!existing) {
      byCampaign.set(row.campaignId, {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        count: 1,
        oldestSentAt: row.sentAt,
      });
      continue;
    }
    existing.count += 1;
    if (row.sentAt < existing.oldestSentAt) existing.oldestSentAt = row.sentAt;
  }

  // Worst first: the campaign with the most unevidenced recipients is the one
  // whose report is furthest from the truth.
  return [...byCampaign.values()].sort((a, b) => b.count - a.count);
}

/**
 * What to tell the operator.
 *
 * Says what is not known rather than implying a failure, and states the
 * deliberate choice not to re-send — otherwise the first instinct on reading
 * it is to go and re-send manually, which is the one action this whole design
 * is arranged to avoid.
 */
export function describeUnconfirmed(group: UnconfirmedGroup): string {
  const people = group.count === 1 ? "recipient" : "recipients";
  return (
    `${group.count} ${people} in "${group.campaignName}" were claimed for ` +
    `sending but no provider message id was ever recorded, so there is no ` +
    `evidence they were delivered. This is the known cost of claiming before ` +
    `sending: a crash loses one email rather than duplicating it to everyone. ` +
    `They are NOT re-sent automatically, because the provider may have ` +
    `accepted them and a duplicate costs more than a miss. If these matter, ` +
    `check the provider's own logs around ${group.oldestSentAt.toISOString()}.`
  );
}
