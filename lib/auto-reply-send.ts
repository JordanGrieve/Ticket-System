import { and, eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import {
  autoReplies,
  forms,
  ticketMessages,
  type AutoReply,
  type Ticket,
  type Workspace,
} from "@/db/schema";
import { addMessage } from "./data";
import { EMAIL_FROM_ADDRESS } from "./config";
import { buildReplyTo } from "./tickets";
import { isValidTimeZone } from "./business-hours";
import {
  checkAutoReplyRateLimits,
  decideAutoReply,
  extractHeaders,
  type AutoReplyConfig,
  type SuppressReason,
} from "./auto-reply";

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

export type AutoReplyOutcome =
  | { sent: true; providerId?: string }
  | { sent: false; reason: SuppressReason | "rate_limited" | "send_failed" };

function hasResendKey(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !!key && key !== "re_placeholder";
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

    const decision = decideAutoReply({
      config,
      workspace,
      ticket: {
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        source: ticket.source,
      },
      formName,
      headers: extractHeaders(input.inboundPayload),
      hasAutomatedReply: outbound.hasAutomatedReply,
      hasHumanReply: outbound.hasHumanReply,
      now: new Date(),
    });

    if (!decision.send) {
      if (decision.reason === "delay_unsupported") {
        console.warn(
          `[auto-reply] workspace ${workspace.id} is stored with delay "${config.delay}", which needs a scheduler this deployment does not have. Nothing was sent.`,
        );
      }
      return { sent: false, reason: decision.reason };
    }

    // Rate limits are consumed only once we've decided to send, so suppressed
    // enquiries don't eat a workspace's budget.
    const limits = checkAutoReplyRateLimits(workspace.id, ticket.customerEmail);
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
  } catch (err) {
    console.error("[auto-reply] failed:", err);
    return { sent: false, reason: "send_failed" };
  }
}
