import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppressions, type SuppressionReason } from "@/db/schema";
import { normaliseEmail, statusForSuppressionReason } from "./newsletter";

/**
 * Suppressions — the durable "never mail this address again" block.
 *
 * ── WHY THIS TABLE IS THE AUTHORITY ──
 *
 * Two records claim to know whether an address may be mailed:
 * `subscribers.status` and a row in `suppressions`. They are written by
 * different events and they DO drift:
 *
 *   • a hard bounce sets status='bounced' AND inserts a suppression row;
 *   • a CSV re-import overwrites the subscriber row back to 'subscribed' —
 *     and cannot touch the suppression, because suppressions are keyed by
 *     EMAIL and outlive the subscriber row being deleted and re-created;
 *   • a subscriber deleted for GDPR erasure takes its status with it, while
 *     the suppression (which is the evidence of the block, not of the person)
 *     stays.
 *
 * So when the two disagree, the subscriber row is the stale one BY
 * CONSTRUCTION. `suppressions` wins, everywhere, and this module is the only
 * place that writes it. The precedence itself lives in one pure function —
 * `sendability()` in lib/newsletter.ts — which the preview path calls and
 * which the SQL in lib/campaign-send.ts mirrors as a LEFT JOIN inside the
 * mutating statements.
 *
 * `subscribers.status` is kept in sync as a CONVENIENCE for the UI (it is what
 * the audience counts and the subscriber list read). It is never the thing a
 * send consults. If a status write fails after a suppression write succeeds,
 * the address is still blocked — that ordering is deliberate, see
 * `suppressAddress`.
 *
 * ── TENANCY ──
 *
 * `suppressions` and `subscribers` both carry workspace_id and every statement
 * here filters it INSIDE the mutating statement (lib/labels.ts pattern), never
 * as a check performed first. A suppression is workspace-scoped on purpose: it
 * is one tenant's relationship with that address, and leaking it across
 * tenants would both block mail another tenant is entitled to send and reveal
 * that the address exists in someone else's list.
 *
 * ── NOTHING HERE CAN SEND EMAIL ──
 *
 * This module imports no provider. It only ever writes blocks.
 */

/** Provider diagnostics and human notes are capped before storage. */
export const SUPPRESSION_NOTE_MAX = 500;

function note(raw: string | null | undefined): string | null {
  const value = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUPPRESSION_NOTE_MAX);
  return value || null;
}

/**
 * Where an unsubscribe came from. Recorded in the suppression note, because
 * "did the human click it or did Gmail POST it" is the first question asked in
 * any dispute about whether an opt-out was honoured.
 */
export type UnsubscribeSource = "one_click" | "link";

export type UnsubscribeOutcome = {
  /** Did the token match a recipient row? */
  matched: boolean;
  /** Did this call create the suppression (false when it already existed)? */
  suppressionCreated: boolean;
  /** How many subscriber rows this call moved to 'unsubscribed'. */
  subscribersUpdated: number;
};

/**
 * Honour an unsubscribe for one campaign-recipient token.
 *
 * ── IDEMPOTENT ──
 * Unsubscribing twice is a success. The insert is ON CONFLICT DO NOTHING and
 * the status update is filtered to rows that are still 'subscribed', so the
 * second call writes nothing and reports `matched: true` all the same. The
 * counters in the result are for logging only — the caller MUST NOT vary its
 * HTTP response on them, or the endpoint becomes a token oracle.
 *
 * ── ONE STATEMENT ──
 * The neon-http driver has no transactions (`drizzle-orm/neon-http` throws on
 * `db.transaction`), so this is expressed as a single statement with
 * data-modifying CTEs. Postgres runs all of them in one snapshot and one
 * implicit transaction: either the address is suppressed AND the subscriber
 * rows are marked, or neither happened. Doing it as two round trips would
 * leave a window where a crash produced a subscriber marked unsubscribed with
 * no durable block — which is the exact drift this table exists to prevent.
 *
 * Data-modifying CTEs are executed to completion whether or not the primary
 * query reads their output, which is what makes the `RETURNING`-into-count
 * shape below safe.
 *
 * ── SCOPE OF THE BLOCK ──
 * Unsubscribing suppresses the address for the WHOLE WORKSPACE, not just the
 * list the campaign drew from. That is the deliberate reading of "unsubscribe"
 * on a shared sending domain: a recipient who opts out of one campaign has not
 * consented to the next one from the same sender under a different list name,
 * and the alternative (per-list opt-out) is how senders end up with a complaint
 * instead of an unsubscribe. Per-topic opt-out would need a schema that does
 * not exist yet.
 *
 * ── REASON ──
 * Recorded as 'manual' because `SuppressionReason` in db/schema.ts is
 * hard_bounce | complaint | manual and there is no 'unsubscribe' member. The
 * note carries the real provenance. Adding a fourth reason is a schema change
 * and is left to whoever owns db/schema.ts — see the report accompanying this
 * work.
 *
 * The workspace is never taken from the request: it is read off the campaign
 * that owns the recipient row, inside the same statement that writes.
 */
export async function unsubscribeByToken(
  token: string,
  source: UnsubscribeSource,
): Promise<UnsubscribeOutcome> {
  const provenance =
    source === "one_click"
      ? "One-click unsubscribe (RFC 8058 List-Unsubscribe POST)"
      : "Unsubscribed via the link in a campaign email";

  const res = await db.execute(sql`
    WITH target AS (
      SELECT
        c.workspace_id                AS workspace_id,
        lower(btrim(cr.email))        AS email,
        cr.campaign_id                AS campaign_id
      FROM campaign_recipients cr
      -- campaign_recipients carries no workspace_id; it inherits tenancy from
      -- the campaign, so the workspace is derived here rather than trusted.
      JOIN campaigns c ON c.id = cr.campaign_id
      WHERE cr.unsubscribe_token = ${token}
      LIMIT 1
    ),
    blocked AS (
      INSERT INTO suppressions (workspace_id, email, reason, note)
      SELECT
        t.workspace_id,
        t.email,
        'manual',
        -- Explicit ::text casts: both operands of the concatenation would
        -- otherwise be of Postgres' "unknown" type and it would not resolve.
        ${provenance}::text || ' (campaign #' || t.campaign_id::text || ')'
      FROM target t
      -- Already blocked: keep the ORIGINAL row. A prior 'complaint' or
      -- 'hard_bounce' must not be rewritten as a softer 'manual' — the reason
      -- is deliverability evidence, and the block is already in force.
      ON CONFLICT (workspace_id, email) DO NOTHING
      RETURNING id
    ),
    marked AS (
      UPDATE subscribers s
      SET status = 'unsubscribed', unsubscribed_at = now()
      FROM target t
      WHERE s.workspace_id = t.workspace_id
        -- Matched on the ADDRESS, not the recipient row's subscriber_id: that
        -- column goes null when a subscriber is deleted, and the unique index
        -- on (workspace_id, email) is case-sensitive, so "Bob@x.com" and
        -- "bob@x.com" can be two rows for one mailbox. Both must stop.
        AND lower(btrim(s.email)) = t.email
        -- Only ever 'subscribed' → 'unsubscribed'. A row already at 'bounced'
        -- or 'complained' keeps that status: it records deliverability damage
        -- the client needs to see, and both are already blocked.
        AND s.status = 'subscribed'
      RETURNING s.id
    )
    SELECT
      (SELECT count(*) FROM target)::int  AS matched,
      (SELECT count(*) FROM blocked)::int AS suppressed,
      (SELECT count(*) FROM marked)::int  AS marked
  `);

  const row = res.rows[0] as
    | { matched: number; suppressed: number; marked: number }
    | undefined;

  return {
    matched: (row?.matched ?? 0) > 0,
    suppressionCreated: (row?.suppressed ?? 0) > 0,
    subscribersUpdated: row?.marked ?? 0,
  };
}

/**
 * Block one address for one workspace, and bring its subscriber rows into
 * line.
 *
 * This is the entry point a bounce/complaint webhook should call. It is
 * exported and tenant-scoped but NOT wired to any provider — there is no
 * webhook route yet (docs/NEWSLETTER.md §6).
 *
 * ORDER IS LOAD-BEARING: the suppression is written first and the subscriber
 * status second, in one statement. If the pair could ever be split, the
 * surviving half must be the block, never the status — an address with a
 * suppression and a stale 'subscribed' status is safe (sends consult
 * suppressions), while a 'bounced' status with no suppression is an address
 * that a re-import silently un-blocks.
 *
 * Soft bounces MUST NOT reach this function. A full mailbox is temporary and
 * suppressing on it deletes a legitimate subscriber; only hard bounces and
 * complaints belong here.
 */
export async function suppressAddress(input: {
  workspaceId: number;
  email: string;
  reason: SuppressionReason;
  note?: string | null;
}): Promise<{ created: boolean; subscribersUpdated: number }> {
  const email = normaliseEmail(input.email);
  if (!email) return { created: false, subscribersUpdated: 0 };

  const status = statusForSuppressionReason(input.reason);

  const res = await db.execute(sql`
    WITH blocked AS (
      INSERT INTO suppressions (workspace_id, email, reason, note)
      VALUES (${input.workspaceId}, ${email}, ${input.reason}, ${note(input.note)})
      ON CONFLICT (workspace_id, email) DO NOTHING
      RETURNING id
    ),
    marked AS (
      UPDATE subscribers s
      SET status = ${status},
          unsubscribed_at = CASE
            WHEN ${status}::text = 'unsubscribed' THEN now()
            ELSE s.unsubscribed_at
          END
      -- The workspace predicate is part of the UPDATE, not a check above it.
      WHERE s.workspace_id = ${input.workspaceId}
        AND lower(btrim(s.email)) = ${email}
        AND s.status = 'subscribed'
      RETURNING s.id
    )
    SELECT
      (SELECT count(*) FROM blocked)::int AS created,
      (SELECT count(*) FROM marked)::int  AS marked
  `);

  const row = res.rows[0] as { created: number; marked: number } | undefined;
  return {
    created: (row?.created ?? 0) > 0,
    subscribersUpdated: row?.marked ?? 0,
  };
}

/**
 * Is this address blocked in this workspace?
 *
 * A convenience for UI ("why is this subscriber not receiving anything?") and
 * for tests. It is NOT how a send is protected: an application-code check can
 * be forgotten by the next caller, so the real enforcement is the LEFT JOIN
 * inside the materialisation and claim statements in lib/campaign-send.ts.
 */
export async function isSuppressed(
  workspaceId: number,
  email: string,
): Promise<boolean> {
  const target = normaliseEmail(email);
  if (!target) return false;
  const [row] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.workspaceId, workspaceId),
        // Compared case-insensitively on both sides: rows written before this
        // module existed were not necessarily normalised, and a suppression
        // that misses because of capitalisation is a send to someone who
        // asked us not to. The column is written out with sql.raw rather than
        // interpolated as a Drizzle column — see lib/data.ts
        // listContactsWithCounts — so it cannot render as a bare name.
        sql`lower(btrim(${sql.raw('"suppressions"."email"')})) = ${target}`,
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Drag `subscribers.status` back into line with `suppressions`.
 *
 * The sweep that makes "suppressions are authoritative" true of the stored
 * data and not merely of the send path. A suppressed address whose subscriber
 * row still says 'subscribed' — the signature of a re-import over a bounce —
 * is moved to the status its suppression implies.
 *
 * It only moves rows OUT of 'subscribed'. It never clears a status, never
 * rewrites one blocked status as another, and it never deletes a suppression:
 * the table is the block, and nothing in this direction can un-block anybody.
 * That one-way property is why it is safe to run unattended.
 *
 * Returns the number of subscriber rows corrected — a non-zero result is worth
 * surfacing, because it means something upstream is writing statuses that
 * disagree with the blocks.
 */
export async function reconcileSuppressedSubscribers(
  workspaceId: number,
): Promise<number> {
  const res = await db.execute(sql`
    UPDATE subscribers s
    SET status = CASE sup.reason
                   WHEN 'hard_bounce' THEN 'bounced'
                   WHEN 'complaint'   THEN 'complained'
                   ELSE 'unsubscribed'
                 END,
        unsubscribed_at = CASE
          WHEN sup.reason = 'manual' THEN COALESCE(s.unsubscribed_at, now())
          ELSE s.unsubscribed_at
        END
    FROM suppressions sup
    WHERE s.workspace_id = ${workspaceId}
      -- BOTH sides are scoped to the workspace. Joining on email alone would
      -- let one tenant's suppression rewrite another tenant's subscriber.
      AND sup.workspace_id = ${workspaceId}
      AND lower(btrim(sup.email)) = lower(btrim(s.email))
      AND s.status = 'subscribed'
    RETURNING s.id
  `);
  return res.rows.length;
}
