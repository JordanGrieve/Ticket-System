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
 * ── NOTHING HERE CAN EMAIL A REAL PERSON ──
 *
 * This module imports no email provider. `sendCampaignBatch` below takes the
 * delivery function as an argument and there is no default, so the only way to
 * mail anybody is for a caller to hand it a live sender — and no route, no
 * Server Action, and no page imports it. That is deliberate: see the
 * "Missing infrastructure" section of docs/NEWSLETTER.md. The loop is written
 * so the claim-before-send protocol can be reviewed and so wiring it up later
 * is a scheduling problem rather than a correctness problem, not because it is
 * ready to run.
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
    const res = await db.execute(sql`
      INSERT INTO campaign_recipients (campaign_id, subscriber_id, email, unsubscribe_token)
      SELECT c.id, s.id, v.email, v.token
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(subscriber_id, email, token)
      JOIN subscribers s
        ON s.id = v.subscriber_id AND s.workspace_id = ${workspaceId}
      JOIN campaigns c
        ON c.id = ${campaignId} AND c.workspace_id = ${workspaceId}
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
  /** True when there may be more queued rows after this batch. */
  more: boolean;
};

/**
 * PHASE TWO: claim a batch of queued recipients and hand each to `deliver`.
 *
 * ⚠️ UNREACHABLE BY DESIGN. Nothing in app/ imports this. Do not export it
 * from a route handler, a Server Action, or a page until the missing
 * infrastructure in docs/NEWSLETTER.md exists — at minimum a durable queue or
 * cron-driven worker, a per-workspace send rate limiter, and a verified
 * marketing sending domain. Calling it from a request handler would tie tens
 * of thousands of provider calls to one HTTP request that will time out
 * halfway through.
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
    const claim = await db
      .update(campaignRecipients)
      .set({
        status: "sent",
        sentAt: new Date(),
        attempts: sql`${campaignRecipients.attempts} + 1`,
      })
      .where(
        and(
          eq(campaignRecipients.id, row.id),
          eq(campaignRecipients.status, "queued"),
        ),
      )
      .returning({ id: campaignRecipients.id });

    // Somebody else got there first. Not an error, and emphatically not a
    // reason to send anyway.
    if (claim.length === 0) continue;
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

  return { claimed, delivered, failed, more: queued.length >= input.limit };
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
