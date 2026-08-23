import { and, eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import {
  autoReplies,
  autoReplyQueue,
  forms,
  ticketMessages,
  tickets,
  workspaces,
  type AutoReply,
  type Ticket,
  type Workspace,
} from "@/db/schema";
import { addMessage } from "./data";
import { EMAIL_FROM_ADDRESS } from "./config";
import { buildReplyTo } from "./tickets";
import { isValidTimeZone } from "./business-hours";
import {
  DEFERRAL_STALE_AFTER_MS,
  extractHeaders,
  planDeferral,
  type AutoReplyConfig,
} from "./auto-reply";
import { rateLimitDurable } from "./rate-limit-store";
import {
  checkAutoReplyRateLimits,
  decideAutoReply,
  type AutoReplyDecision,
  type AutoReplyLimiter,
  type SuppressReason,
} from "./auto-reply-guards";

/**
 * Auto-acknowledgement engine — the IO half: read/write the config, and
 * actually send.
 *
 * Split from lib/auto-reply.ts so the decision logic stays importable by the
 * settings screen (a client component) and by the tests, neither of which can
 * pull in the database or the mail provider.
 */

function toConfig(row: AutoReply): AutoReplyConfig {
  return {
    enabled: row.enabled,
    subject: row.subject,
    body: row.body,
    outOfHoursBody: row.outOfHoursBody,
    delay: row.delay,
    scheduleMode: row.scheduleMode,
    businessHours: row.businessHours ?? null,
    // A zone Intl doesn't recognise would silently evaluate as UTC deeper in;
    // normalise here so what we read back matches what we act on.
    timezone: isValidTimeZone(row.timezone) ? row.timezone : "UTC",
    skipIfTeammateReplied: row.skipIfTeammateReplied,
  };
}

/** The workspace's stored config, or null when it has never been set up. */
export async function getAutoReplyConfig(
  workspaceId: number,
): Promise<AutoReplyConfig | null> {
  const rows = await db
    .select()
    .from(autoReplies)
    .where(eq(autoReplies.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ? toConfig(rows[0]) : null;
}

/**
 * Upsert on workspaceId — the unique index is what makes this the single row
 * per workspace the schema promises.
 */
export async function saveAutoReplyConfig(
  workspaceId: number,
  config: AutoReplyConfig,
): Promise<AutoReplyConfig> {
  const values = {
    workspaceId,
    enabled: config.enabled,
    subject: config.subject,
    body: config.body,
    outOfHoursBody: config.outOfHoursBody,
    delay: config.delay,
    scheduleMode: config.scheduleMode,
    businessHours: config.businessHours,
    timezone: config.timezone,
    skipIfTeammateReplied: config.skipIfTeammateReplied,
  };

  const [row] = await db
    .insert(autoReplies)
    .values(values)
    .onConflictDoUpdate({
      target: autoReplies.workspaceId,
      // DB clock, not the app's — mixing the two skews "last saved".
      set: { ...values, updatedAt: sql`now()` },
    })
    .returning();

  return toConfig(row);
}

/**
 * Who has already spoken on this ticket, split the way the guard needs it:
 * our own acknowledgement (the idempotency check) and a human's reply (the
 * `skipIfTeammateReplied` check). One scan, two booleans — asking twice would
 * read the same rows twice and could disagree with itself under a concurrent
 * insert.
 */
export async function ticketOutboundKinds(
  ticketId: number,
): Promise<{ hasAutomatedReply: boolean; hasHumanReply: boolean }> {
  const rows = await db
    .select({ automated: ticketMessages.automated })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.ticketId, ticketId),
        eq(ticketMessages.direction, "outbound"),
      ),
    );
  return {
    hasAutomatedReply: rows.some((r) => r.automated),
    // Rows written before ticket_messages.automated existed default to false
    // and so count as human here. See the column's note in db/schema.ts.
    hasHumanReply: rows.some((r) => !r.automated),
  };
}

/** The named form a ticket arrived through, scoped to its workspace. */
async function getFormName(
  workspaceId: number,
  formId: number | null,
): Promise<string | null> {
  if (formId == null) return null;
  const rows = await db
    .select({ name: forms.name })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspaceId)))
    .limit(1);
  return rows[0]?.name ?? null;
}

/**
 * The mail-loop counters, and the ONE place that decides they must be durable.
 *
 * `rateLimitDurable` fails open by design: on a database error it quietly falls
 * back to the per-instance in-memory limiter and returns a perfectly ordinary
 * `ok` result. For the public contact form that is correct. For a mail-loop
 * guard it is not — see the block comment on `checkAutoReplyRateLimits` — so
 * this wrapper turns the silent degradation back into a hard error by
 * confirming the counter actually landed in the shared table.
 *
 * One extra indexed read per check, on a path that runs at most a few times an
 * hour per workspace. If the database is unreachable this SELECT throws, which
 * is exactly the signal the guard needs; if the write silently fell back to
 * memory, the row is absent and we throw ourselves.
 */
export const durableAutoReplyLimit: AutoReplyLimiter = async (key, opts) => {
  const result = await rateLimitDurable(key, opts);

  // FAIL CLOSED, unlike the public endpoints.
  //
  // rateLimitDurable degrades to a per-instance Map when the database is
  // unreachable, and reports that as `degraded`. For a contact form that is
  // right: refusing everyone through an outage loses real enquiries silently.
  // Here the cost of refusing is a courtesy acknowledgement — the ticket still
  // exists, the mail is still in the inbox, a human still replies — while the
  // cost of allowing is a mail loop against the shared sending domain, which
  // damages the reputation carrying every other tenant's ticket replies.
  //
  // The failure modes also correlate: a running loop generates exactly the load
  // that makes the counter stop answering, so the moment it degrades is the
  // moment it matters most, and the fallback at that moment is per-instance —
  // no real ceiling at all.
  if (result.degraded) {
    throw new Error(
      `rate limit for "${key}" fell back to per-instance counting; refusing rather than risk a mail loop`,
    );
  }

  return result;
};

export type AutoReplyOutcome =
  | { sent: true; providerId?: string }
  /** Held for the next working period; see `enqueueDeferredAutoReply`. */
  | { sent: false; reason: "deferred"; dueAt: Date }
  | { sent: false; reason: SuppressReason | "rate_limited" | "send_failed" };

function hasResendKey(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !!key && key !== "re_placeholder";
}

/**
 * Rate-limit, send, record. The ONE place an acknowledgement leaves the
 * building, shared by the immediate path and the deferred sweep.
 *
 * It is shared deliberately rather than duplicated: the rate limits, the
 * RFC 3834 headers, the per-ticket Reply-To and the "record only after the
 * provider accepted it" rule are all loop-safety machinery, and a second copy
 * of them would drift. The deferred path is precisely the one where drift is
 * dangerous — see the sweep's header.
 */
async function deliverDecidedAutoReply(
  workspace: Pick<Workspace, "id" | "name">,
  ticket: Pick<Ticket, "id" | "customerEmail" | "replyToken">,
  decision: Extract<AutoReplyDecision, { send: true }>,
): Promise<AutoReplyOutcome> {
  // Rate limits are consumed only once we've decided to send, so suppressed
  // enquiries don't eat a workspace's budget.
  const limits = await checkAutoReplyRateLimits(
    workspace.id,
    ticket.customerEmail,
    durableAutoReplyLimit,
  );
  if (!limits.ok) {
    console.warn(
      `[auto-reply] rate limit hit (${limits.scope}) for workspace ${workspace.id}`,
    );
    return { sent: false, reason: "rate_limited" };
  }

  if (!hasResendKey()) {
    console.warn("[auto-reply] RESEND_API_KEY not configured — not sending.");
    return { sent: false, reason: "send_failed" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    // Always our verified domain; the workspace name is the display name.
    from: `${workspace.name} <${EMAIL_FROM_ADDRESS}>`,
    to: [ticket.customerEmail],
    subject: decision.subject,
    text: decision.body,
    // Per-ticket Reply-To. If the far end IS a robot, its reply threads into
    // this existing ticket rather than opening a new one — and we only ever
    // acknowledge ticket CREATION, so the exchange dies there.
    replyTo: buildReplyTo(ticket.id, ticket.replyToken),
    headers: {
      // RFC 3834 — tells other well-behaved responders not to reply to this.
      "Auto-Submitted": "auto-replied",
      Precedence: "auto_reply",
      // Exchange/Outlook's equivalent.
      "X-Auto-Response-Suppress": "All",
    },
  });

  if (error) {
    console.error("[auto-reply] send failed:", error);
    return { sent: false, reason: "send_failed" };
  }

  // Recorded only after the provider accepted it: this outbound row IS the
  // "already answered" guard, so writing it on a failed send would
  // permanently suppress an acknowledgement that never went out.
  await addMessage({
    ticketId: ticket.id,
    direction: "outbound",
    body: decision.body,
    // The flag that makes this row distinguishable from an agent's reply,
    // and so the thing that makes skipIfTeammateReplied mean anything. If
    // this is ever dropped the guard silently reverts to treating our own
    // acknowledgement as a human answer.
    automated: true,
    // Deliberately no status change — a robot acknowledging receipt has not
    // put the ticket "in progress".
  });

  return { sent: true, providerId: data?.id };
}

/**
 * Hold an acknowledgement until the workspace is next open.
 *
 * `onConflictDoNothing` on the unique ticket index is the idempotency: a
 * retried inbound webhook, or a second call for the same ticket, must not
 * queue a second acknowledgement. It also means an already-terminal row (one
 * we sent, suppressed or failed this morning) is never resurrected.
 */
async function enqueueDeferredAutoReply(input: {
  workspaceId: number;
  ticketId: number;
  dueAt: Date;
  headers: Record<string, string> | null;
}): Promise<void> {
  await db
    .insert(autoReplyQueue)
    .values({
      workspaceId: input.workspaceId,
      ticketId: input.ticketId,
      dueAt: input.dueAt,
      headers: input.headers,
    })
    .onConflictDoNothing({ target: autoReplyQueue.ticketId });
}

/**
 * Send the acknowledgement for a freshly created ticket, if every guard says
 * yes. Strictly best-effort: ticket creation must never fail because of this,
 * so everything is wrapped and failures are logged rather than thrown.
 *
 * `inboundPayload` is the raw webhook body for email-sourced tickets — its
 * headers are what the bulk/automated check reads. Form submissions carry no
 * headers and pass that check trivially, which is correct: a form POST is a
 * human action, not a machine talking to us.
 */
export async function maybeSendAutoReply(input: {
  workspace: Workspace;
  ticket: Ticket;
  inboundPayload?: Record<string, unknown> | null;
}): Promise<AutoReplyOutcome> {
  try {
    const { workspace, ticket } = input;
    const config = await getAutoReplyConfig(workspace.id);
    if (!config || !config.enabled) {
      return { sent: false, reason: config ? "disabled" : "not_configured" };
    }

    const [formName, outbound] = await Promise.all([
      getFormName(workspace.id, ticket.formId),
      ticketOutboundKinds(ticket.id),
    ]);

    const now = new Date();
    const headers = extractHeaders(input.inboundPayload);
    const decision = decideAutoReply({
      config,
      workspace,
      ticket: {
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        source: ticket.source,
      },
      formName,
      headers,
      hasAutomatedReply: outbound.hasAutomatedReply,
      hasHumanReply: outbound.hasHumanReply,
      now,
    });

    if (!decision.send) {
      if (decision.reason === "delay_unsupported") {
        console.warn(
          `[auto-reply] workspace ${workspace.id} is stored with delay "${config.delay}", which needs a scheduler this deployment does not have. Nothing was sent.`,
        );
      }

      // Closed right now, and the schedule is the ONLY thing stopping us:
      // hold it rather than drop it. Every other suppression reason is a
      // refusal on the merits (a robot, a loop, an answer already sent) and
      // must stay a refusal — queueing one would just delay the wrong send.
      if (decision.reason === "schedule") {
        const dueAt = planDeferral(config, now);
        if (dueAt) {
          await enqueueDeferredAutoReply({
            workspaceId: workspace.id,
            ticketId: ticket.id,
            dueAt,
            // Stored because the automated/bulk guard re-runs at send time and
            // the webhook payload will be long gone by then.
            headers: Object.keys(headers).length > 0 ? headers : null,
          });
          return { sent: false, reason: "deferred", dueAt };
        }
        // No window to wait for (none configured, or nothing inside the
        // horizon). This really is a drop, and the settings screen says so.
        console.warn(
          `[auto-reply] workspace ${workspace.id}: enquiry suppressed by schedule with nothing to defer to; no acknowledgement will be sent for ticket ${ticket.id}.`,
        );
      }

      return { sent: false, reason: decision.reason };
    }

    return await deliverDecidedAutoReply(workspace, ticket, decision);
  } catch (err) {
    console.error("[auto-reply] failed:", err);
    return { sent: false, reason: "send_failed" };
  }
}

// ── The deferred sweep ───────────────────────────────────────────

/**
 * Rows claimed per tick. Small on purpose. The sweep has no deadline pressure —
 * 25 rows every five minutes drains 300 an hour, far above any plausible
 * overnight backlog for a support desk, while keeping one tick's blast radius
 * small if a workspace's config turns out to be pathological.
 */
export const AUTO_REPLY_SWEEP_LIMIT = 25;

/** Provider failures we will re-attempt before giving up on a held reply. */
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 15 * 60 * 1000;

type ClaimedQueueRow = {
  id: number;
  workspaceId: number;
  ticketId: number;
  dueAt: Date;
  attempts: number;
  headers: Record<string, string> | null;
};

export type SweepAutoReplySummary = {
  claimed: number;
  sent: number;
  suppressed: number;
  requeued: number;
  failed: number;
  errored: number;
};

async function settleQueueRow(
  id: number,
  status: "sent" | "suppressed" | "failed",
  reason: string | null,
): Promise<void> {
  await db
    .update(autoReplyQueue)
    .set({ status, reason, updatedAt: sql`now()` })
    .where(eq(autoReplyQueue.id, id));
}

async function requeueQueueRow(
  id: number,
  dueAt: Date,
  attempts: number,
  reason: string,
): Promise<void> {
  await db
    .update(autoReplyQueue)
    .set({
      status: "pending",
      dueAt,
      attempts,
      reason,
      claimedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(autoReplyQueue.id, id));
}

/**
 * Claim a bounded batch of due rows, latching `pending → sending` inside the
 * UPDATE itself.
 *
 * Read-then-write would let two overlapping ticks both see the same pending row
 * and both mail it. `FOR UPDATE SKIP LOCKED` on the inner select means a
 * concurrent sweep steps over rows this one is taking rather than blocking
 * behind them. Same claim-before-send discipline as lib/campaign-send.ts, for
 * the same reason: the safe direction of failure is "not sent", never "sent
 * twice".
 */
async function claimDueAutoReplies(limit: number): Promise<ClaimedQueueRow[]> {
  const res = await db.execute(sql`
    UPDATE auto_reply_queue SET
      status = 'sending',
      claimed_at = now(),
      updated_at = now()
    WHERE id IN (
      SELECT id FROM auto_reply_queue
      WHERE status = 'pending' AND due_at <= now()
      ORDER BY due_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, workspace_id, ticket_id, due_at, attempts, headers
  `);

  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: Number(row.id),
      workspaceId: Number(row.workspace_id),
      ticketId: Number(row.ticket_id),
      dueAt: new Date(row.due_at as string),
      attempts: Number(row.attempts),
      headers: (row.headers as Record<string, string> | null) ?? null,
    };
  });
}

/**
 * Send one held acknowledgement, or decide not to.
 *
 * ── EVERY GUARD RUNS AGAIN, HERE, NOW ──
 *
 * This is the whole risk of deferral, and the reason this function re-derives
 * almost everything. A queue that froze its decision at 21:00 and replayed it
 * at 09:00 would be a mail loop with a timer on it: overnight two
 * autoresponders each open a ticket, nothing is sent, the per-recipient limiter
 * never fires because it only counts SENDS — and then the morning sweep fires
 * the whole accumulated pile at once, while nobody is watching. That is
 * strictly worse than looping at 21:00, when the limiter would have killed it
 * within two rounds.
 *
 * So, at SEND time and not at queue time:
 *  • the config is re-read — switched off, retemplated or rescheduled since
 *    last night, all honoured, and the body is rendered from today's template;
 *  • `decideAutoReply` runs in full: self and role addresses, the stored
 *    inbound headers, "have we already acknowledged this ticket", "did a human
 *    reply overnight", and the schedule itself;
 *  • the DURABLE rate limiters are consumed here, inside
 *    `deliverDecidedAutoReply` — one per address per ten minutes, three an
 *    hour, sixty per workspace an hour. They therefore do their counting in the
 *    morning burst, where the sends actually are, and they still fail CLOSED.
 *
 * The only thing carried over from queue time is the inbound header map, which
 * cannot be re-derived because the webhook payload is gone.
 */
async function processDeferredAutoReply(
  row: ClaimedQueueRow,
  now: Date,
): Promise<"sent" | "suppressed" | "requeued" | "failed"> {
  // Far too late. A sweep that has been dead for a day must not wake up and
  // mail acknowledgements for enquiries a human has long since answered.
  if (now.getTime() - row.dueAt.getTime() > DEFERRAL_STALE_AFTER_MS) {
    await settleQueueRow(row.id, "suppressed", "expired");
    return "suppressed";
  }

  // Both ids in the WHERE: the queue row names its workspace, and the ticket is
  // only ever loaded through it. A mismatch reads as "gone", never as another
  // tenant's ticket.
  const found = await db
    .select({ ticket: tickets, workspace: workspaces })
    .from(tickets)
    .innerJoin(workspaces, eq(workspaces.id, tickets.workspaceId))
    .where(
      and(eq(tickets.id, row.ticketId), eq(tickets.workspaceId, row.workspaceId)),
    )
    .limit(1);

  const pair = found[0];
  if (!pair) {
    await settleQueueRow(row.id, "suppressed", "ticket_gone");
    return "suppressed";
  }
  const { ticket, workspace } = pair;

  const config = await getAutoReplyConfig(workspace.id);
  const [formName, outbound] = await Promise.all([
    getFormName(workspace.id, ticket.formId),
    ticketOutboundKinds(ticket.id),
  ]);

  const decision = decideAutoReply({
    config,
    workspace,
    ticket: {
      customerName: ticket.customerName,
      customerEmail: ticket.customerEmail,
      source: ticket.source,
    },
    formName,
    headers: row.headers,
    hasAutomatedReply: outbound.hasAutomatedReply,
    hasHumanReply: outbound.hasHumanReply,
    now,
  });

  if (!decision.send) {
    // Still closed. Either the sweep arrived a minute early, or the workspace
    // changed its hours overnight; re-plan against the CURRENT window rather
    // than dropping something we promised to hold.
    if (decision.reason === "schedule" && config) {
      const dueAt = planDeferral(config, now);
      if (dueAt) {
        await requeueQueueRow(row.id, dueAt, row.attempts, "rescheduled");
        return "requeued";
      }
    }
    await settleQueueRow(row.id, "suppressed", decision.reason);
    return "suppressed";
  }

  const outcome = await deliverDecidedAutoReply(workspace, ticket, decision);
  if (outcome.sent) {
    await settleQueueRow(row.id, "sent", null);
    return "sent";
  }

  // `rate_limited` is TERMINAL, not a retry. The limiter is the mail-loop
  // brake; retrying past it later would be a way of eventually sending
  // everything it refused, which is the same as not having it.
  if (outcome.reason === "rate_limited") {
    await settleQueueRow(row.id, "suppressed", "rate_limited");
    return "suppressed";
  }

  const attempts = row.attempts + 1;
  if (attempts >= MAX_SEND_ATTEMPTS) {
    await settleQueueRow(row.id, "failed", outcome.reason);
    return "failed";
  }
  await requeueQueueRow(
    row.id,
    new Date(now.getTime() + RETRY_BACKOFF_MS),
    attempts,
    outcome.reason,
  );
  return "requeued";
}

/**
 * One tick of the deferred-acknowledgement worker. Driven by
 * GET /api/cron/auto-replies.
 *
 * Bounded and resumable: it claims at most `limit` rows and returns. There is
 * no loop that drains the queue, because the next tick continues and a function
 * that runs until it is killed loses whatever it was half-way through.
 */
export async function sweepAutoReplyQueue({
  limit = AUTO_REPLY_SWEEP_LIMIT,
  now = new Date(),
}: { limit?: number; now?: Date } = {}): Promise<SweepAutoReplySummary> {
  const claimed = await claimDueAutoReplies(limit);
  const summary: SweepAutoReplySummary = {
    claimed: claimed.length,
    sent: 0,
    suppressed: 0,
    requeued: 0,
    failed: 0,
    errored: 0,
  };

  for (const row of claimed) {
    try {
      const result = await processDeferredAutoReply(row, now);
      summary[result] += 1;
    } catch (err) {
      // One bad row must not abandon the rest: they belong to different
      // tenants. The row is left in `sending` deliberately — it will not be
      // re-claimed, so a row that reliably throws cannot become a poison pill
      // that mails the same person on every tick.
      console.error(
        `[cron/auto-replies] queue row ${row.id} (workspace ${row.workspaceId}) failed:`,
        err,
      );
      summary.errored += 1;
    }
  }

  return summary;
}
