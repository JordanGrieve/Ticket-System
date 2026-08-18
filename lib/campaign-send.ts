import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaignRecipients,
  campaigns,
  listSubscribers,
  lists,
  subscribers,
  suppressions,
  workspaces,
  type Campaign,
  type RecipientStatus,
} from "@/db/schema";
import { generateUnsubscribeToken } from "./tokens";
import {
  isEditableStatus,
  listUnsubscribeHeaders,
  renderCampaign,
  selectAudience,
  unsubscribeUrl,
  type AudienceCandidate,
  type AudienceSelection,
  type CampaignDraftInput,
} from "./newsletter";

/**
 * Newsletter engine — the IO half. Database reads and writes, plus the send
 * loop. The pure decision/render logic is in lib/newsletter.ts.
 *
 * ── THIS MODULE STILL IMPORTS NO EMAIL PROVIDER ──
 *
 * `sendCampaignBatch` below takes the delivery function as an argument and
 * there is NO default, so the only way to mail anybody is for a caller to hand
 * it a live sender.
 *
 * That caller now exists: app/api/cron/campaigns/route.ts, driven by Vercel
 * Cron. It is not a loosening of the rule — it is the "durable, resumable
 * worker" docs/NEWSLETTER.md §2 names as prerequisite 1, and it is the only
 * importer. What it hands in comes from `createCampaignDeliverer()` in
 * lib/deliver.ts, which returns a LOG-ONLY deliverer unless
 * `CAMPAIGN_DELIVERY_MODE=ses`, a variable set in no environment. So the wiring
 * is complete and the send is still inert, which is the state the remaining
 * items in §2 and §7 — cross-invocation rate limiting, the bounce/complaint
 * webhook, a verified marketing domain, and consent enforcement — require.
 *
 * Do not add a second caller. In particular, no Server Action and no page may
 * import this: sending is a scheduled activity with a bounded batch, and a
 * request handler that calls it ties tens of thousands of provider calls to one
 * HTTP request that will time out halfway through.
 *
 * ── TENANCY ──
 *
 * Same discipline as lib/labels.ts. `campaigns`, `lists`, `subscribers` and
 * `suppressions` carry workspace_id; `campaign_recipients` and
 * `list_subscribers` deliberately do not — they inherit it through their
 * parent. So every read here either filters workspace_id directly or joins up
 * to a parent that does, and every write carries the workspace predicate
 * INSIDE the mutating statement rather than checking beforehand and then
 * writing, which a concurrent request could invalidate.
 *
 * A campaign's `listId` is always read back off the campaign row we already
 * proved belongs to this workspace. It is never taken from the request, so a
 * caller cannot point their campaign at another tenant's list.
 *
 * ── SUPPRESSION ──
 *
 * "A send must never go to a suppressed address" is enforced in SQL, inside
 * the statements that mutate, at all three points where a row could otherwise
 * slip through:
 *
 *   1. materialiseAudience — the INSERT LEFT JOINs `suppressions` and takes
 *      only the misses, so a suppressed address cannot become a recipient row;
 *   2. sendCampaignBatch — a sweep retires queued rows whose address has been
 *      suppressed since materialisation;
 *   3. the claim UPDATE itself — a NOT EXISTS that closes the window between
 *      (2) and the provider call.
 *
 * `selectAudience` also filters, but that is for REPORTING (it is what
 * produces the per-reason skip counts the composer shows). It is not the
 * guarantee: application-level filtering is one forgotten caller away from
 * mailing somebody who hard-bounced or reported us for spam, and on a shared
 * sending domain that damage lands on every other tenant's support mail.
 *
 * `suppressions` outranks `subscribers.status` wherever they disagree — the
 * rule, and why, is in lib/suppressions.ts and lib/newsletter.ts sendability().
 */

// ── Campaign reads ───────────────────────────────────────────────

export type CampaignSummary = {
  id: number;
  name: string;
  subject: string;
  status: Campaign["status"];
  listId: number | null;
  listName: string | null;
  recipientCount: number;
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A workspace's campaigns, newest first. */
export async function listCampaigns(
  workspaceId: number,
): Promise<CampaignSummary[]> {
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      subject: campaigns.subject,
      status: campaigns.status,
      listId: campaigns.listId,
      listName: lists.name,
      recipientCount: campaigns.recipientCount,
      scheduledAt: campaigns.scheduledAt,
      sentAt: campaigns.sentAt,
      createdAt: campaigns.createdAt,
      updatedAt: campaigns.updatedAt,
    })
    .from(campaigns)
    // Left join: `campaigns.listId` is "set null" on list deletion, so a sent
    // campaign outlives its audience and must still appear in the listing.
    // The join also filters the list's workspace, so a list id that somehow
    // pointed across tenants would render as null rather than leak a name.
    .leftJoin(
      lists,
      and(eq(lists.id, campaigns.listId), eq(lists.workspaceId, workspaceId)),
    )
    .where(eq(campaigns.workspaceId, workspaceId))
    .orderBy(desc(campaigns.createdAt));
}

/** One campaign, or null when the id isn't this workspace's. */
export async function getCampaign(
  workspaceId: number,
  campaignId: number,
): Promise<Campaign | null> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

export type RecipientBreakdown = Record<RecipientStatus, number>;

function emptyBreakdown(): RecipientBreakdown {
  return {
    queued: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
  };
}

/**
 * Per-status recipient counts for the campaign report.
 *
 * `campaign_recipients` has no workspace_id, so this joins up to `campaigns`
 * and filters there. Counting the child table on campaign_id alone would be
 * correct only for as long as nobody can guess another tenant's campaign id,
 * which is exactly the assumption this codebase refuses to make.
 */
export async function campaignRecipientBreakdown(
  workspaceId: number,
  campaignId: number,
): Promise<RecipientBreakdown> {
  const rows = await db
    .select({
      status: campaignRecipients.status,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    )
    .groupBy(campaignRecipients.status);

  const out = emptyBreakdown();
  for (const r of rows) out[r.status] = r.count;
  return out;
}

// ── Campaign writes ──────────────────────────────────────────────

/**
 * Create a draft.
 *
 * `listId` is validated against this workspace before it is stored: an id
 * belonging to another tenant is rejected outright rather than saved and
 * quietly ignored later, because a draft that names an audience it cannot read
 * would report "0 recipients" instead of "that isn't your list".
 */
export async function createCampaign(
  workspaceId: number,
  input: CampaignDraftInput,
): Promise<Campaign | { error: "unknown_list" }> {
  if (input.listId !== null) {
    const owned = await listBelongsToWorkspace(workspaceId, input.listId);
    if (!owned) return { error: "unknown_list" };
  }

  const [created] = await db
    .insert(campaigns)
    .values({
      workspaceId,
      name: input.name,
      subject: input.subject,
      preheader: input.preheader,
      templateKey: input.templateKey,
      body: input.body,
      listId: input.listId,
      status: "draft",
    })
    .returning();

  return created;
}

/**
 * Edit a draft. Null when the id isn't this workspace's; `not_editable` once
 * the campaign has started sending — see isEditableStatus.
 */
export async function updateCampaign(
  workspaceId: number,
  campaignId: number,
  patch: Partial<CampaignDraftInput>,
): Promise<Campaign | null | { error: "not_editable" | "unknown_list" }> {
  const existing = await getCampaign(workspaceId, campaignId);
  if (!existing) return null;
  if (!isEditableStatus(existing.status)) return { error: "not_editable" };

  if (patch.listId !== undefined && patch.listId !== null) {
    const owned = await listBelongsToWorkspace(workspaceId, patch.listId);
    if (!owned) return { error: "unknown_list" };
  }

  const [updated] = await db
    .update(campaigns)
    .set({ ...patch, updatedAt: new Date() })
    // The workspace predicate is part of the UPDATE, not a check performed
    // above it: `existing` was read in a separate statement and could in
    // principle be stale by now.
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    )
    .returning();

  return updated ?? null;
}

async function listBelongsToWorkspace(
  workspaceId: number,
  listId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

// ── Audience ─────────────────────────────────────────────────────

/**
 * Everyone on a list, with the fields the selection logic needs.
 *
 * `list_subscribers` carries no workspace_id. Both of its parents are filtered
 * here — the list must be this workspace's AND so must the subscriber — which
 * is belt and braces, but it means a mis-set membership row could not leak a
 * subscriber into another tenant's campaign even if one were somehow written.
 */
async function listMembers(
  workspaceId: number,
  listId: number,
): Promise<AudienceCandidate[]> {
  return db
    .select({
      subscriberId: subscribers.id,
      email: subscribers.email,
      name: subscribers.name,
      status: subscribers.status,
    })
    .from(listSubscribers)
    .innerJoin(lists, eq(lists.id, listSubscribers.listId))
    .innerJoin(subscribers, eq(subscribers.id, listSubscribers.subscriberId))
    .where(
      and(
        eq(lists.id, listId),
        eq(lists.workspaceId, workspaceId),
        eq(subscribers.workspaceId, workspaceId),
      ),
    );
}

/** Every suppressed address in this workspace. Scoped, and only ever scoped. */
async function suppressedEmails(workspaceId: number): Promise<string[]> {
  const rows = await db
    .select({ email: suppressions.email })
    .from(suppressions)
    .where(eq(suppressions.workspaceId, workspaceId));
  return rows.map((r) => r.email);
}

/**
 * What WOULD be materialised, without writing anything.
 *
 * The composer shows this before the client commits. It runs the same
 * `selectAudience` the write path runs, so the number on screen and the number
 * of rows created are produced by one piece of code.
 */
export async function previewAudience(
  workspaceId: number,
  campaignId: number,
): Promise<AudienceSelection | null | { error: "no_list" }> {
  const campaign = await getCampaign(workspaceId, campaignId);
  if (!campaign) return null;
  if (campaign.listId === null) return { error: "no_list" };

  const [candidates, blocked] = await Promise.all([
    listMembers(workspaceId, campaign.listId),
    suppressedEmails(workspaceId),
  ]);
  return selectAudience(candidates, blocked);
}

export type MaterialiseResult = {
  selection: AudienceSelection;
  /** Rows this call actually created. Zero on a re-run of a complete campaign. */
  inserted: number;
  /** Total queued+sent+… rows now attached to the campaign. */
  total: number;
};

/**
 * PHASE ONE of the send: turn the audience into campaign_recipients rows.
 *
 * This is the idempotent half. `INSERT … ON CONFLICT (campaign_id,
 * subscriber_id) DO NOTHING` means re-running after a crash, a timeout, or a
 * double-clicked button adds only the rows that were missing and touches
 * nothing that already exists — including rows already marked `sent`. The
 * unique index is doing the work; this function has no opinion about whether
 * it has run before.
 *
 * It is safe to call on its own precisely because it sends nothing. Phase two
 * (sendCampaignBatch) is the part that has no home yet.
 *
 * Refused once the campaign has left draft/scheduled: re-materialising a
 * campaign that is mid-send would add recipients the client never reviewed to
 * a send already in flight.
 */
export async function materialiseAudience(
  workspaceId: number,
  campaignId: number,
): Promise<
  MaterialiseResult | null | { error: "no_list" | "not_editable" }
> {
  const campaign = await getCampaign(workspaceId, campaignId);
  if (!campaign) return null;
  if (!isEditableStatus(campaign.status)) return { error: "not_editable" };
  if (campaign.listId === null) return { error: "no_list" };

  const [candidates, blocked] = await Promise.all([
    listMembers(workspaceId, campaign.listId),
    suppressedEmails(workspaceId),
  ]);
  const selection = selectAudience(candidates, blocked);

  let inserted = 0;
  // Chunked so one campaign of 200k does not become a single statement that
  // exceeds Postgres' parameter limit or holds a lock for minutes.
  for (const chunk of chunks(selection.members, 500)) {
    const values = chunk.map(
      (m) =>
        sql`(${m.subscriberId}::int, ${m.email}::text, ${generateUnsubscribeToken()}::text)`,
    );

    // The workspace predicate lives in the INSERT itself. `v` supplies the
    // per-row data; the joins re-assert that the subscriber and the campaign
    // both belong to this workspace, so a row could not be written into
    // another tenant's campaign even if the ids above were wrong.
    //
    // ── SUPPRESSION ENFORCEMENT ──
    // The LEFT JOIN + `sup.id IS NULL` is where "a send must never go to a
    // suppressed address" is actually enforced. It is in the statement that
    // WRITES, not in a check above it, for three reasons:
    //
    //  1. `selectAudience` already dropped these addresses using the set read
    //     a moment ago — but that read and this write are separate round
    //     trips. Somebody who unsubscribes in between (one-click unsubscribes
    //     arrive unattended, at any moment) would otherwise be materialised.
    //  2. A future caller can forget an application-code filter. It cannot
    //     forget this one: there is no path that creates a recipient row
    //     except through this statement.
    //  3. It is the same discipline as the workspace predicate above, for the
    //     same reason — a check performed first can be invalidated by a
    //     concurrent request before the write lands.
    //
    // Matched on lower(btrim(…)) on BOTH sides: `suppressions` has no
    // functional index and rows written before lib/suppressions.ts existed
    // were not necessarily normalised. A suppression that misses on
    // capitalisation is a send to someone who asked us not to, which is worse
    // than the sequential scan.
    const res = await db.execute(sql`
      INSERT INTO campaign_recipients (campaign_id, subscriber_id, email, unsubscribe_token)
      SELECT c.id, s.id, v.email, v.token
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(subscriber_id, email, token)
      JOIN subscribers s
        ON s.id = v.subscriber_id AND s.workspace_id = ${workspaceId}
      JOIN campaigns c
        ON c.id = ${campaignId} AND c.workspace_id = ${workspaceId}
      LEFT JOIN suppressions sup
        ON sup.workspace_id = ${workspaceId}
       AND lower(btrim(sup.email)) = lower(btrim(v.email))
      WHERE sup.id IS NULL
      ON CONFLICT (campaign_id, subscriber_id) DO NOTHING
      RETURNING campaign_recipients.id
    `);
    inserted += res.rows.length;
  }

  const total = await countRecipients(workspaceId, campaignId);

  // `recipientCount` is a cached number for the listing UI. campaign_recipients
  // stays the truth — this is refreshed from it, never incremented blind.
  await db
    .update(campaigns)
    .set({ recipientCount: total, updatedAt: new Date() })
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    );

  return { selection, inserted, total };
}

async function countRecipients(
  workspaceId: number,
  campaignId: number,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    );
  return row?.count ?? 0;
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

// ── Phase two: the send loop (NOT WIRED UP) ──────────────────────

/**
 * One message, fully rendered, ready for a provider.
 *
 * Note this type carries the List-Unsubscribe headers. They are not optional
 * decoration: Gmail and Yahoo require one-click unsubscribe from bulk senders,
 * and a send path that can forget them is a send path that will.
 */
export type OutboundCampaignEmail = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

/**
 * The provider call, injected. There is NO default and this module imports no
 * provider — that is the mechanism that makes the loop below incapable of
 * mailing anyone until somebody deliberately supplies a sender.
 */
export type CampaignDeliverer = (
  email: OutboundCampaignEmail,
) => Promise<{ id?: string }>;

export type SendBatchResult = {
  claimed: number;
  delivered: number;
  failed: number;
  /**
   * Queued rows dropped because the address became suppressed after the
   * audience was materialised. Reported separately from `failed` because it is
   * the system working, not the provider refusing.
   */
  suppressed: number;
  /** True when there may be more queued rows after this batch. */
  more: boolean;
};

/**
 * Retire queued rows whose address has since been suppressed.
 *
 * Materialisation already excludes suppressed addresses, but a campaign can sit
 * queued for hours while it drains, and one-click unsubscribes and bounce
 * webhooks arrive unattended throughout. Without this sweep those rows sit
 * queued forever: the claim below refuses them, so every batch re-reads them
 * and `more` never settles.
 *
 * They are moved to `failed` with an explicit error string rather than a
 * dedicated status, because `RecipientStatus` has no "skipped" member and
 * inventing one is a schema change. The error text is what makes the campaign
 * report honest about why the row was not sent — see rule 5: a visible gap
 * beats a plausible-looking number.
 *
 * `campaign_recipients` carries no workspace_id, so the statement joins up to
 * `campaigns` and filters there, and the suppression is matched inside the
 * same UPDATE.
 */
async function retireSuppressedQueuedRows(
  workspaceId: number,
  campaignId: number,
): Promise<number> {
  const res = await db.execute(sql`
    UPDATE campaign_recipients cr
    SET status = 'failed',
        error = 'Suppressed: this address is on the workspace suppression list.'
    FROM campaigns c
    WHERE cr.campaign_id = c.id
      AND c.id = ${campaignId}
      AND c.workspace_id = ${workspaceId}
      AND cr.status = 'queued'
      AND EXISTS (
        SELECT 1 FROM suppressions sup
        WHERE sup.workspace_id = c.workspace_id
          AND lower(btrim(sup.email)) = lower(btrim(cr.email))
      )
    RETURNING cr.id
  `);
  return res.rows.length;
}

/**
 * PHASE TWO: claim a batch of queued recipients and hand each to `deliver`.
 *
 * ⚠️ ONE CALLER ONLY: app/api/cron/campaigns/route.ts. Do not export it from a
 * Server Action or a page. Everything below assumes the caller is a scheduled
 * worker that is happy to be re-invoked — `limit` is expected to be small
 * enough that the whole loop fits inside one function invocation, because
 * there is no resumption point in the middle of it.
 *
 * Still missing, and still required before `CAMPAIGN_DELIVERY_MODE=ses` may be
 * set (docs/NEWSLETTER.md §2, §7): a per-workspace rate limiter that survives
 * across invocations, the bounce/complaint webhook, a verified marketing
 * sending domain, and consent enforcement in `selectAudience`.
 *
 * ── The claim protocol ──
 *
 *   UPDATE campaign_recipients
 *      SET status = 'sent', sent_at = now(), attempts = attempts + 1
 *    WHERE id = $1 AND status = 'queued'
 *   RETURNING id
 *
 * The row is claimed BEFORE the provider is called, and the provider is only
 * called if that UPDATE returned a row. A second worker, or the same worker
 * retried, gets zero rows and sends nothing. `status` is the latch and the
 * unique index from phase one is the idempotency key.
 *
 * This is claim-before-send, and the cost is stated plainly in db/schema.ts: a
 * crash between the UPDATE and the provider call LOSES that email rather than
 * duplicating it. Losing one beats mailing someone twice. The residue is rows
 * sitting at `sent` with no providerMessageId, which a reconciliation sweep has
 * to find — that sweep does not exist yet either.
 *
 * The claim is one statement per row on purpose. Claiming a batch in a single
 * UPDATE would be faster and wrong: a crash mid-batch would mark every row in
 * it sent, silently dropping the whole batch instead of one message.
 */
export async function sendCampaignBatch(input: {
  workspaceId: number;
  campaignId: number;
  /** How many rows to attempt. Keep well under any provider rate limit. */
  limit: number;
  deliver: CampaignDeliverer;
  /** Envelope sender. Must be on the MARKETING domain, not replies@. */
  from: string;
  workspaceName: string;
  /** Absolute app URL — passed in, never read from lib/config here. */
  appUrl: string;
  /** Monitored mailto for List-Unsubscribe, or null to omit it. */
  unsubscribeMailto: string | null;
}): Promise<SendBatchResult> {
  const campaign = await getCampaign(input.workspaceId, input.campaignId);
  if (!campaign) throw new Error("Campaign not found in this workspace");

  // Before anything is claimed: retire rows whose address was suppressed after
  // materialisation. Runs first so the batch below cannot even read them.
  const suppressed = await retireSuppressedQueuedRows(
    input.workspaceId,
    input.campaignId,
  );

  // Queued rows for this campaign, joined up to `campaigns` for tenancy.
  const queued = await db
    .select({
      id: campaignRecipients.id,
      email: campaignRecipients.email,
      token: campaignRecipients.unsubscribeToken,
      subscriberId: campaignRecipients.subscriberId,
    })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(
      and(
        eq(campaigns.id, input.campaignId),
        eq(campaigns.workspaceId, input.workspaceId),
        eq(campaignRecipients.status, "queued"),
      ),
    )
    .limit(input.limit);

  // Names live on `subscribers`, not on the recipient row (which freezes only
  // the address). One extra round trip beats a join that would silently drop
  // recipients whose subscriber has since been deleted.
  const names = await subscriberNames(
    input.workspaceId,
    queued.map((q) => q.subscriberId).filter((id): id is number => id !== null),
  );

  let claimed = 0;
  let delivered = 0;
  let failed = 0;

  for (const row of queued) {
    // The claim carries THREE predicates, all inside the UPDATE: the latch
    // (`status = 'queued'`), the workspace (via the join up to `campaigns`,
    // because campaign_recipients carries no workspace_id), and the
    // suppression check. The last one is a backstop for the window between the
    // sweep above and this statement — a one-click unsubscribe landing inside
    // that window must not be beaten by a send that was already in flight.
    const claim = await db.execute(sql`
      UPDATE campaign_recipients cr
      SET status = 'sent', sent_at = now(), attempts = cr.attempts + 1
      FROM campaigns c
      WHERE cr.id = ${row.id}
        AND cr.status = 'queued'
        AND cr.campaign_id = c.id
        AND c.workspace_id = ${input.workspaceId}
        AND NOT EXISTS (
          SELECT 1 FROM suppressions sup
          WHERE sup.workspace_id = c.workspace_id
            AND lower(btrim(sup.email)) = lower(btrim(cr.email))
        )
      RETURNING cr.id
    `);

    // Zero rows: somebody else claimed it, or the address was suppressed a
    // moment ago. Neither is an error, and emphatically neither is a reason to
    // send anyway.
    if (claim.rows.length === 0) continue;
    claimed += 1;

    const url = unsubscribeUrl(input.appUrl, row.token);
    const rendered = renderCampaign({
      campaign,
      recipient: {
        email: row.email,
        name: row.subscriberId === null ? null : (names.get(row.subscriberId) ?? null),
      },
      workspaceName: input.workspaceName,
      unsubscribeUrl: url,
    });

    try {
      const res = await input.deliver({
        to: row.email,
        from: input.from,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        headers: listUnsubscribeHeaders({
          url,
          mailto: input.unsubscribeMailto,
        }),
      });
      delivered += 1;
      await db
        .update(campaignRecipients)
        .set({ providerMessageId: res.id ?? null })
        .where(eq(campaignRecipients.id, row.id));
    } catch (err) {
      failed += 1;
      // Back to 'failed', not 'queued': re-queueing would let a permanent
      // failure (a rejected address) be retried forever, and `attempts` has
      // already been incremented so a retry sweep can tell them apart.
      await db
        .update(campaignRecipients)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(campaignRecipients.id, row.id));
    }
  }

  return {
    claimed,
    delivered,
    failed,
    suppressed,
    more: queued.length >= input.limit,
  };
}

// ── The scheduled sweep's reads and writes ───────────────────────

/**
 * A campaign the sweep should push on, with everything the batch needs.
 *
 * `workspaceId` is read off the campaign row, never supplied by a caller —
 * same rule as `listId`. Every statement downstream of this is scoped with it.
 */
export type DueCampaign = {
  id: number;
  workspaceId: number;
  workspaceName: string;
};

/**
 * Promote `scheduled` campaigns whose time has come to `sending`.
 *
 * ── Why the EXISTS clause is not optional ──
 *
 * A campaign is only promoted if it already has at least one `queued`
 * recipient row. Without that predicate, a campaign scheduled but never
 * materialised would be promoted, drain instantly (there is nothing to drain),
 * and be marked `sent` — a campaign that mailed nobody, reported as a success,
 * and now un-editable because `sending` is past `isEditableStatus`. Leaving it
 * sitting at `scheduled` is a visible gap, which is the outcome we want.
 *
 * ── Tenancy ──
 *
 * This is the one statement in this module that is deliberately NOT scoped to a
 * workspace: a scheduler that could only see one tenant would not be a
 * scheduler. It reads no addresses and no content — it moves a status column
 * and returns ids. Everything after it, including the campaign read and every
 * recipient statement, is scoped by the workspace_id this returns.
 *
 * Concurrency: `status = 'scheduled'` in the WHERE is the latch, so two
 * overlapping ticks cannot both promote the same row. Even if they could, the
 * per-recipient claim in sendCampaignBatch is the guard that actually matters.
 */
async function promoteDueScheduledCampaigns(): Promise<number> {
  const res = await db.execute(sql`
    UPDATE campaigns c
    SET status = 'sending', updated_at = now()
    WHERE c.status = 'scheduled'
      AND c.scheduled_at IS NOT NULL
      AND c.scheduled_at <= now()
      AND EXISTS (
        SELECT 1 FROM campaign_recipients cr
        WHERE cr.campaign_id = c.id AND cr.status = 'queued'
      )
    RETURNING c.id
  `);
  return res.rows.length;
}

/**
 * Campaigns with work left to do, oldest-touched first.
 *
 * ── Ordering is fairness, not cosmetics ──
 *
 * `ORDER BY updated_at` is a round robin: `settleCampaign` below stamps
 * `updated_at` after every batch, so a campaign that was just worked on goes to
 * the back of the queue. Ordering by id instead would mean the lowest-numbered
 * campaign is picked every single tick and a second tenant's campaign never
 * starts until the first has fully drained — hours of one tenant's mail
 * blocking everyone else's, with nothing in the UI to explain it.
 *
 * The EXISTS clause is what makes a drained campaign disappear from the sweep
 * even in the window before `settleCampaign` has marked it `sent`.
 */
export async function claimDueCampaigns(limit: number): Promise<DueCampaign[]> {
  await promoteDueScheduledCampaigns();

  const rows = await db
    .select({
      id: campaigns.id,
      workspaceId: campaigns.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(campaigns)
    .innerJoin(workspaces, eq(workspaces.id, campaigns.workspaceId))
    .where(
      and(
        eq(campaigns.status, "sending"),
        sql`EXISTS (
          SELECT 1 FROM campaign_recipients cr
          WHERE cr.campaign_id = ${campaigns.id} AND cr.status = 'queued'
        )`,
      ),
    )
    .orderBy(campaigns.updatedAt)
    .limit(limit);

  return rows;
}

export type SettleResult = { completed: boolean };

/**
 * Close the loop after a batch: mark the campaign `sent` if it has drained,
 * and stamp `updated_at` either way.
 *
 * One statement, because the two halves must not disagree. The
 * "has it drained?" question and the write that acts on the answer being
 * separate round trips is how a campaign gets marked `sent` while a recipient
 * row inserted a moment ago is still queued — the row then sits queued forever,
 * because the sweep above only looks at campaigns in `sending`.
 *
 * `status = 'sending'` in the WHERE means this cannot resurrect a `failed`
 * campaign or re-stamp an already-`sent` one, and `sent_at` is only written
 * when it is null so a re-run does not move the timestamp.
 *
 * Note what "drained" means: no `queued` rows left. Rows sitting at `failed` —
 * including the ones retired by the suppression sweep — count as drained. They
 * are not lost, they are on the campaign report with their error text, and the
 * alternative is a campaign that can never finish because one address bounced.
 */
export async function settleCampaign(
  workspaceId: number,
  campaignId: number,
): Promise<SettleResult> {
  const res = await db.execute(sql`
    UPDATE campaigns c
    SET status = CASE WHEN NOT EXISTS (
          SELECT 1 FROM campaign_recipients cr
          WHERE cr.campaign_id = c.id AND cr.status = 'queued'
        ) THEN 'sent' ELSE c.status END,
        sent_at = CASE WHEN c.sent_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM campaign_recipients cr
          WHERE cr.campaign_id = c.id AND cr.status = 'queued'
        ) THEN now() ELSE c.sent_at END,
        updated_at = now()
    WHERE c.id = ${campaignId}
      AND c.workspace_id = ${workspaceId}
      AND c.status = 'sending'
    RETURNING c.status
  `);

  const status = res.rows[0]?.status;
  return { completed: status === "sent" };
}

async function subscriberNames(
  workspaceId: number,
  ids: number[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: subscribers.id, name: subscribers.name })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.workspaceId, workspaceId),
        inArray(subscribers.id, ids),
      ),
    );
  for (const r of rows) out.set(r.id, r.name);
  return out;
}
