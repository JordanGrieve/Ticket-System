import type { TicketSource } from "@/db/schema";
import { EMAIL_FROM_ADDRESS, INBOUND_DOMAIN } from "./config";
import { parseTicketRefFromAddress } from "./tickets";
import type { RateLimitResult } from "./rate-limit";
import { evaluateSchedule } from "./business-hours";
import {
  buildMergeValues,
  isAutomatedMail,
  isDelaySupported,
  isRoleOrNoReplyAddress,
  renderTemplate,
  type AutoReplyConfig,
} from "./auto-reply";

/**
 * Auto-acknowledgement engine — the SERVER half of the decision.
 *
 * This is a straight lift out of lib/auto-reply.ts. No logic changed; only the
 * file boundary did. The reason is a bundling one.
 *
 * lib/auto-reply.ts is imported by the settings screen, which is a client
 * component, and its own header promises the module is safe there. It was not:
 * it imported `lib/config` (for EMAIL_FROM_ADDRESS and INBOUND_DOMAIN in the
 * self-address guard) and `lib/tickets` (which also reaches config). So the
 * whole of lib/config was being evaluated in the browser — the exact failure
 * that took production down through the mail nav (Sentry POSTBOX-6), reached by
 * a second, independent route nobody had noticed. Non-NEXT_PUBLIC_ env vars do
 * not exist in a browser, so INBOUND_DOMAIN silently became the placeholder
 * there, and any secret later added to config would have shipped in a public
 * chunk.
 *
 * Everything that needs config, or needs something that needs config, now lives
 * here. lib/auto-reply.ts keeps the merge tokens, templates, labels and header
 * predicates — the parts the settings screen actually imports — and is once
 * again genuinely client-safe. `lib/config` carries `server-only`, so this
 * boundary is now enforced by the build rather than by good intentions.
 *
 * Nothing in here is imported by any client component: the callers are
 * lib/auto-reply-send.ts, the API route, and the tests.
 */

// ── Loop guards ──────────────────────────────────────────────────

/**
 * Addresses we must never send an acknowledgement to, because they are US.
 * Replying to any of these is a guaranteed loop: our own mail is forwarded
 * back into the inbound webhook by design.
 */
export function selfAddresses(workspace: {
  inboundEmail: string;
  sendingEmail: string;
}): string[] {
  return [EMAIL_FROM_ADDRESS, workspace.inboundEmail, workspace.sendingEmail]
    .filter(Boolean)
    .map((a) => a.trim().toLowerCase());
}

/**
 * True when `addr` is a plus-tagged alias of `self` — same local part before
 * the "+", same domain. Deliberately one-directional: we ask "is the candidate
 * an alias of one of ours", never the reverse, so a stranger's
 * hello@other.example is not mistaken for ours.
 */
function isPlusAliasOf(addr: string, self: string): boolean {
  const [addrLocal, addrDomain] = addr.split("@");
  const [selfLocal, selfDomain] = self.split("@");
  if (!addrLocal || !addrDomain || !selfLocal || !selfDomain) return false;
  if (addrDomain !== selfDomain) return false;
  if (!addrLocal.includes("+")) return false;
  return addrLocal.slice(0, addrLocal.indexOf("+")) === selfLocal;
}

export function isSelfAddress(
  email: string,
  workspace: { inboundEmail: string; sendingEmail: string },
): boolean {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return true;
  if (selfAddresses(workspace).includes(addr)) return true;
  // Plus-tag aliases of our own addresses are still our own addresses.
  // hello+anything@client.co.uk delivers to hello@client.co.uk, so an exact
  // comparison alone would acknowledge the workspace's own inbox. That did not
  // loop forever only because the inbound route drops mail from our sending
  // address a hop later — a backstop this guard should not be leaning on.
  if (selfAddresses(workspace).some((self) => isPlusAliasOf(addr, self))) {
    return true;
  }
  // Anything on the inbound domain is one of our own ingestion addresses,
  // including the per-ticket reply addresses of OTHER tickets.
  if (addr.endsWith(`@${INBOUND_DOMAIN.toLowerCase()}`)) return true;
  if (parseTicketRefFromAddress(addr)) return true;
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── The decision ─────────────────────────────────────────────────

export type SuppressReason =
  | "not_configured"
  | "disabled"
  | "delay_unsupported"
  | "invalid_recipient"
  | "self_address"
  | "role_address"
  | "automated_mail"
  // We have already acknowledged this ticket. Never conditional.
  | "already_answered"
  // A human got there first, and skipIfTeammateReplied says stay out of it.
  | "teammate_replied"
  | "schedule";

export type AutoReplyDecision =
  | { send: false; reason: SuppressReason }
  | { send: true; subject: string; body: string; inHours: boolean };

export type DecisionInput = {
  config: AutoReplyConfig | null;
  workspace: { name: string; inboundEmail: string; sendingEmail: string };
  ticket: {
    customerName: string;
    customerEmail: string;
    source: TicketSource;
  };
  formName?: string | null;
  /** Normalised inbound headers, when the enquiry came from email. */
  headers?: Record<string, string> | null;
  /**
   * Have WE already sent an acknowledgement on this ticket? Outbound rows
   * carrying ticket_messages.automated.
   */
  hasAutomatedReply: boolean;
  /**
   * Has a HUMAN already sent something on this ticket? Outbound rows that are
   * not automated.
   *
   * Two fields rather than one "hasOutboundMessage", because they gate on
   * different things: the first is idempotency and is absolute, the second is
   * a courtesy the workspace can switch off. Collapsing them is what made
   * skipIfTeammateReplied a setting that did nothing.
   */
  hasHumanReply: boolean;
  now: Date;
};

/**
 * The whole guard chain, pure and testable. Order matters: the cheap absolute
 * refusals come first, so a loop is broken before any work happens.
 */
export function decideAutoReply(input: DecisionInput): AutoReplyDecision {
  const { config, workspace, ticket } = input;

  if (!config) return { send: false, reason: "not_configured" };
  if (!config.enabled) return { send: false, reason: "disabled" };

  // 1. The recipient must be a real, single mailbox.
  const to = (ticket.customerEmail ?? "").trim().toLowerCase();
  if (!to || to.length > 254 || !EMAIL_RE.test(to)) {
    return { send: false, reason: "invalid_recipient" };
  }

  // 2. Never talk to ourselves. Clients auto-forward their support mail into
  //    our inbound webhook, so replying to one of our own addresses is an
  //    immediate infinite loop.
  if (isSelfAddress(to, workspace)) {
    return { send: false, reason: "self_address" };
  }

  // 3. Never talk to a robot's mailbox or a list's plumbing.
  if (isRoleOrNoReplyAddress(to)) {
    return { send: false, reason: "role_address" };
  }

  // 4. Never answer mail that declares itself automated or bulk.
  if (isAutomatedMail(input.headers)) {
    return { send: false, reason: "automated_mail" };
  }

  // 5. One acknowledgement per ticket, ever. Unconditional: sending a second
  //    one is a bug whatever the settings say, and this is the check that
  //    holds when skipIfTeammateReplied is OFF.
  if (input.hasAutomatedReply) {
    return { send: false, reason: "already_answered" };
  }

  // 6. Don't talk over a colleague — but only if the workspace asked us not
  //    to. Switching it off means "acknowledge anyway", which is a legitimate
  //    choice: the acknowledgement confirms receipt, and a workspace may want
  //    that sent even when someone happened to answer first.
  if (input.hasHumanReply && config.skipIfTeammateReplied) {
    return { send: false, reason: "teammate_replied" };
  }

  // 7. The delay must be one we can actually honour.
  if (!isDelaySupported(config.delay)) {
    return { send: false, reason: "delay_unsupported" };
  }

  // 8. Schedule, evaluated in the workspace's own timezone.
  const schedule = evaluateSchedule(
    config.scheduleMode,
    input.now,
    config.businessHours,
    config.timezone,
  );
  if (!schedule.allowed) return { send: false, reason: "schedule" };

  const values = buildMergeValues({
    customerName: ticket.customerName,
    customerEmail: ticket.customerEmail,
    formName: input.formName,
    source: ticket.source,
    workspaceName: workspace.name,
  });

  const bodyTemplate =
    !schedule.inHours && config.outOfHoursBody?.trim()
      ? config.outOfHoursBody
      : config.body;

  return {
    send: true,
    subject: renderTemplate(config.subject, values),
    body: renderTemplate(bodyTemplate, values),
    inHours: schedule.inHours,
  };
}

// ── Rate limits ──────────────────────────────────────────────────

/**
 * Two independent throttles, because they stop different failures:
 *
 *  • per WORKSPACE — a runaway form or a scripted flood can't turn our
 *    sending domain into a spam cannon or burn the whole Resend quota.
 *  • per RECIPIENT — this is the one that actually kills robot ping-pong.
 *    Two autoresponders open a NEW ticket on every round, so the per-ticket
 *    guard never fires against them; only "we already emailed this address
 *    very recently" breaks that cycle.
 *
 * All three counters are DURABLE (Postgres, one atomic upsert per check) rather
 * than the module-level Map in lib/rate-limit.ts. The in-memory limiter is per
 * serverless instance, so its true ceiling is (instances × limit) — which for a
 * mail loop is no ceiling at all, because a loop IS concurrency: every round
 * trip can land on a cold instance with an empty counter.
 *
 * The limiter is INJECTED rather than imported. lib/rate-limit-store.ts carries
 * `server-only` and pulls in the database, and this module is imported by the
 * pure guard tests, which run without one. The only production caller is
 * lib/auto-reply-send.ts, which is on the IO side already and passes the strict
 * durable limiter defined there.
 */
export type AutoReplyLimiter = (
  key: string,
  opts: { max: number; windowMs: number },
) => Promise<RateLimitResult>;

/**
 * ⚠️ THIS GUARD FAILS **CLOSED**. READ BEFORE CHANGING. ⚠️
 *
 * lib/rate-limit-store.ts deliberately fails OPEN: if the database is
 * unreachable it degrades to the in-memory limiter rather than refusing, so a
 * client's public contact form never returns 429 to real customers during a
 * database outage. That is the right trade for a form, and wrong here.
 *
 * The asymmetry is the whole argument:
 *
 *  • Failing closed on a mail-loop guard costs a COURTESY. The ticket is still
 *    created, the customer's mail is still in the inbox, a human still replies.
 *    Nobody's enquiry is lost; an acknowledgement is merely not sent, and the
 *    suppression is logged.
 *  • Failing open costs the SENDING DOMAIN. An escaped loop sends thousands of
 *    messages from the address that carries every tenant's transactional mail.
 *    That damage is shared, slow to undo, and hits clients who had nothing to
 *    do with the workspace that looped.
 *
 * And the failure modes CORRELATE, which is what makes fail-open actively
 * dangerous here: a running loop generates exactly the load that produces
 * statement timeouts, so the moment the durable counter stops answering is the
 * moment it is most needed. Degrading to a per-instance Map at that point is
 * degrading to nothing.
 *
 * So: any error out of the limiter is a REFUSAL, not a shrug. Because
 * `rateLimitDurable` swallows its own database errors, the caller must pass a
 * limiter that THROWS when the counter did not durably land — see
 * `durableAutoReplyLimit` in lib/auto-reply-send.ts. Passing `rateLimitDurable`
 * directly would silently reinstate the fail-open behaviour this comment exists
 * to prevent.
 */
export async function checkAutoReplyRateLimits(
  workspaceId: number,
  recipient: string,
  limiter: AutoReplyLimiter,
): Promise<
  { ok: true } | { ok: false; scope: "workspace" | "recipient" | "unavailable" }
> {
  try {
    // Order is load-bearing and the checks are sequential, never Promise.all:
    // a refusal must short-circuit so the later counters are not consumed by a
    // send that was already refused.
    const perWorkspace = await limiter(`autoreply:ws:${workspaceId}`, {
      max: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!perWorkspace.ok) return { ok: false, scope: "workspace" };

    const to = recipient.trim().toLowerCase();
    // At most one acknowledgement to the same person in 10 minutes…
    const burst = await limiter(`autoreply:to10:${workspaceId}:${to}`, {
      max: 1,
      windowMs: 10 * 60 * 1000,
    });
    if (!burst.ok) return { ok: false, scope: "recipient" };
    // …and at most three in an hour, so a slow loop can't tick along all day.
    const hourly = await limiter(`autoreply:to60:${workspaceId}:${to}`, {
      max: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (!hourly.ok) return { ok: false, scope: "recipient" };

    return { ok: true };
  } catch (err) {
    // See the block comment above: an uncountable send is a refused send.
    console.error(
      `[auto-reply] durable rate limit unavailable for workspace ${workspaceId} — refusing to send (fail closed):`,
      err,
    );
    return { ok: false, scope: "unavailable" };
  }
}
