import type {
  AutoReplyDelay,
  AutoReplySchedule,
  BusinessHours,
  TicketSource,
} from "@/db/schema";
import { EMAIL_FROM_ADDRESS, INBOUND_DOMAIN } from "./config";
import { parseTicketRefFromAddress } from "./tickets";
import { rateLimit } from "./rate-limit";
import { DEFAULT_BUSINESS_HOURS, evaluateSchedule } from "./business-hours";

/**
 * Auto-acknowledgement engine — the decision half.
 *
 * An auto-reply is an automated email sent to whatever address an enquiry
 * arrived from. That is a loop generator unless it is fenced properly: two
 * autoresponders will happily talk to each other until someone's quota runs
 * out, and one auto-reply to a mailing-list post lands in hundreds of inboxes.
 * Every guard in this file exists because of that, and they all run BEFORE
 * anything is composed or sent — see `decideAutoReply`.
 *
 * The discipline mirrors app/api/inbound/route.ts, which already refuses to
 * ingest our own outbound mail.
 *
 * Everything here is PURE and free of database and provider imports, on
 * purpose: the settings screen's live preview runs the very same renderer the
 * send path does (a preview that lies is worse than none), and the tests can
 * import it without a DATABASE_URL. The IO half lives in lib/auto-reply-send.ts.
 */

// ── Merge tokens ─────────────────────────────────────────────────

export type MergeTokenName = "first_name" | "form_name" | "company";

export const MERGE_TOKENS: {
  name: MergeTokenName;
  token: string;
  label: string;
  hint: string;
}[] = [
  {
    name: "first_name",
    token: "{first_name}",
    label: "First name",
    hint: "Becomes “there” when we don’t know a name",
  },
  {
    name: "form_name",
    token: "{form_name}",
    label: "Form name",
    hint: "The form the enquiry came through",
  },
  {
    name: "company",
    token: "{company}",
    label: "Company",
    hint: "Your workspace name",
  },
];

/**
 * What an unresolved name becomes.
 *
 * A customer must never see a literal `{first_name}`, so the only question is
 * what replaces it. Two options were on the table:
 *
 *   (a) drop the token and clean up around it — "Hi {first_name}," becomes
 *       "Hi," which reads like a truncation bug;
 *   (b) substitute a neutral placeholder — "Hi there,".
 *
 * (b) wins, because the token is used almost exclusively in a greeting and a
 * greeting has to stay grammatical. "Hi there," is what a human writes when
 * they don't know your name; "Hi," is what a broken mail-merge produces. The
 * cost is that a workspace writing "Your order, {first_name}, is ready" gets
 * "Your order, there, is ready" — clumsy, but still a sentence, and the live
 * preview shows it with the name missing before they ever hit save.
 *
 * Names that are really email addresses count as unknown: inbound mail with no
 * display name is stored as `customerName = sender.email`, so
 * "Hi bob.smith@acme.co," is the common case, not the exotic one.
 */
export const UNKNOWN_FIRST_NAME = "there";

/** Extract a usable first name, or the fallback. */
export function firstNameFrom(
  customerName: string | null | undefined,
  customerEmail?: string | null,
): string {
  const raw = (customerName ?? "").trim();
  if (!raw) return UNKNOWN_FIRST_NAME;
  // A display name that is an address tells us nothing a customer wants read
  // back to them.
  if (raw.includes("@")) return UNKNOWN_FIRST_NAME;
  if (customerEmail && raw.toLowerCase() === customerEmail.trim().toLowerCase()) {
    return UNKNOWN_FIRST_NAME;
  }

  const first = raw
    .split(/\s+/)[0]
    .replace(/^["'`(<[]+/, "")
    .replace(/["'`)>\].,;:!?]+$/, "")
    .trim();
  if (first.length < 2) return UNKNOWN_FIRST_NAME;
  // Digits or URL punctuation mean this isn't a first name.
  if (/[0-9/\\|]/.test(first)) return UNKNOWN_FIRST_NAME;

  // Normalise shouting and all-lowercase sign-ups; leave mixed case alone so
  // "McDonald" and "O'Neill" survive intact.
  if (first === first.toUpperCase()) {
    return first[0] + first.slice(1).toLowerCase();
  }
  if (first === first.toLowerCase()) {
    return first[0].toUpperCase() + first.slice(1);
  }
  return first;
}

/** What `{form_name}` becomes when the ticket isn't tied to a named form. */
export function formNameFallback(source: TicketSource): string {
  return source === "contact_form" ? "our contact form" : "email";
}

export type MergeValues = Record<string, string>;

export function buildMergeValues(input: {
  customerName: string | null | undefined;
  customerEmail?: string | null;
  formName?: string | null;
  source: TicketSource;
  workspaceName: string;
}): MergeValues {
  return {
    first_name: firstNameFrom(input.customerName, input.customerEmail),
    form_name: (input.formName ?? "").trim() || formNameFallback(input.source),
    company: input.workspaceName.trim() || "our team",
  };
}

/**
 * Substitute merge tokens.
 *
 * Two hard rules:
 *  1. no `{anything}` survives into the output — an unknown or misspelled
 *     token (`{firstname}`, `{order_id}`) is deleted, never passed through, so
 *     a customer cannot receive a literal placeholder;
 *  2. the result is tidied, so a deleted token doesn't leave "Hi ," or a
 *     double space behind.
 *
 * Newlines are preserved — only runs of spaces/tabs inside a line collapse.
 */
export function renderTemplate(template: string, values: MergeValues): string {
  const substituted = (template ?? "").replace(
    /\{\s*([a-z0-9_]+)\s*\}/gi,
    (_match, name: string) => {
      const value = values[name.toLowerCase()];
      return typeof value === "string" ? value.trim() : "";
    },
  );
  return tidy(substituted);
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, " ")
        // " ," / " ." left behind by a removed token.
        .replace(/[ \t]+([,.!?;:])/g, "$1")
        .replace(/[ \t]+$/g, ""),
    )
    .join("\n")
    .trim();
}

// ── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_SUBJECT = "We got your message, {first_name}";

export const DEFAULT_BODY = `Hi {first_name},

Thanks for getting in touch through {form_name} — your message has reached us and we'll come back to you as soon as we can.

You don't need to do anything else. If you remember something you'd like to add, just reply to this email.

— {company}`;

export const DEFAULT_OUT_OF_HOURS_BODY = `Hi {first_name},

Thanks for getting in touch. Your message has reached us, but it's arrived outside our normal hours — we'll pick it up when we're next open.

— {company}`;

/**
 * Delays we can actually honour. `5min` and `1hr` need a queue or a scheduled
 * worker that this deployment does not have; see the settings screen and the
 * handover notes. Storing an unhonourable delay would turn "enabled" into a
 * silent no-op, which is the worst possible failure for this feature.
 */
export const SUPPORTED_DELAYS: AutoReplyDelay[] = ["immediate"];

export function isDelaySupported(delay: AutoReplyDelay): boolean {
  return SUPPORTED_DELAYS.includes(delay);
}

export const DELAY_LABELS: Record<AutoReplyDelay, string> = {
  immediate: "Immediately",
  "5min": "After 5 minutes",
  "1hr": "After 1 hour",
};

export const SCHEDULE_LABELS: Record<AutoReplySchedule, string> = {
  always: "Always",
  business_hours: "During business hours only",
  out_of_hours: "Outside business hours only",
};

/** The shape the settings screen and the API exchange. */
export type AutoReplyConfig = {
  enabled: boolean;
  subject: string;
  body: string;
  outOfHoursBody: string | null;
  delay: AutoReplyDelay;
  scheduleMode: AutoReplySchedule;
  businessHours: BusinessHours | null;
  timezone: string;
  skipIfTeammateReplied: boolean;
};

export const DEFAULT_CONFIG: AutoReplyConfig = {
  enabled: false,
  subject: DEFAULT_SUBJECT,
  body: DEFAULT_BODY,
  outOfHoursBody: DEFAULT_OUT_OF_HOURS_BODY,
  delay: "immediate",
  scheduleMode: "always",
  businessHours: DEFAULT_BUSINESS_HOURS,
  timezone: "Europe/London",
  skipIfTeammateReplied: true,
};

// ── Loop guards (pure) ───────────────────────────────────────────

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

export function isSelfAddress(
  email: string,
  workspace: { inboundEmail: string; sendingEmail: string },
): boolean {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return true;
  if (selfAddresses(workspace).includes(addr)) return true;
  // Anything on the inbound domain is one of our own ingestion addresses,
  // including the per-ticket reply addresses of OTHER tickets.
  if (addr.endsWith(`@${INBOUND_DOMAIN.toLowerCase()}`)) return true;
  if (parseTicketRefFromAddress(addr)) return true;
  return false;
}

const ROLE_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "no_reply",
  "no.reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "autoreply",
  "auto-reply",
  "auto_reply",
  "autoresponder",
  "mailer-daemon",
  "mailerdaemon",
  "postmaster",
  "abuse",
  "bounce",
  "bounces",
  "daemon",
  "listserv",
  "majordomo",
  "owner",
  "root",
  "nobody",
  "notification",
  "notifications",
  "undisclosed-recipients",
]);

/**
 * Role, bulk and machine addresses. Auto-replying to `mailer-daemon@` or a
 * list's `-bounces@` address is the classic way to build a mail storm, and
 * RFC 3834 says explicitly not to.
 */
export function isRoleOrNoReplyAddress(email: string): boolean {
  const addr = (email ?? "").trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at <= 0) return true; // not a mailbox we can reason about
  const local = addr.slice(0, at);
  const base = local.split("+")[0];
  if (ROLE_LOCAL_PARTS.has(local) || ROLE_LOCAL_PARTS.has(base)) return true;
  if (local.includes("+bounce")) return true;
  if (/(^|[-_.])(bounces?|request|owner|unsubscribe|confirm)$/.test(base)) {
    return true;
  }
  if (/^(no|do)[-_.]?no?t?[-_.]?repl(y|ies)/.test(base)) return true;
  return false;
}

/** Normalise a webhook `headers` field (array or record) to lower-cased keys. */
export function extractHeaders(
  data: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  const raw = data.headers;
  if (Array.isArray(raw)) {
    for (const h of raw as Array<Record<string, unknown>>) {
      const name = typeof h?.name === "string" ? h.name.toLowerCase() : "";
      const value = typeof h?.value === "string" ? h.value : "";
      if (name) out[name] = value;
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k.toLowerCase()] = v;
    }
  }
  return out;
}

/**
 * Does this message announce itself as automated or bulk?
 *
 * Every well-behaved autoresponder, mailing list and bounce carries at least
 * one of these headers. Honouring them is the other half of the contract we
 * take on by stamping `Auto-Submitted: auto-replied` on our own sends.
 */
export function isAutomatedMail(
  headers: Record<string, string> | null | undefined,
): boolean {
  if (!headers) return false;
  const get = (name: string) => (headers[name] ?? "").trim().toLowerCase();

  // RFC 3834: anything other than an explicit "no" means automated.
  const autoSubmitted = get("auto-submitted");
  if (autoSubmitted && autoSubmitted !== "no") return true;

  const precedence = get("precedence");
  if (["bulk", "list", "junk", "auto_reply", "auto-reply"].includes(precedence)) {
    return true;
  }

  // Exchange/Outlook's suppression header. Any value means "don't respond".
  if (get("x-auto-response-suppress")) return true;

  // Mailing lists — a reply here can reach every subscriber.
  for (const listHeader of [
    "list-id",
    "list-unsubscribe",
    "list-post",
    "list-help",
    "list-subscribe",
  ]) {
    if (get(listHeader)) return true;
  }

  // Vendor-specific autoresponder and bounce markers.
  for (const marker of [
    "x-autoreply",
    "x-autorespond",
    "x-autoresponder",
    "x-loop",
    "x-failed-recipients",
  ]) {
    if (get(marker)) return true;
  }

  // A null return-path is a bounce, by definition never to be replied to.
  if (get("return-path") === "<>") return true;

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
  | "already_answered"
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
   * Does the ticket already carry an outbound message? True means either we
   * already acknowledged it or a teammate already replied — both are reasons
   * to stay quiet.
   */
  hasOutboundMessage: boolean;
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

  // 5. One acknowledgement per ticket, ever — and never over the top of a
  //    human. We cannot distinguish our own acknowledgement from an agent's
  //    reply without a column to mark it, so this is unconditional rather
  //    than gated on `skipIfTeammateReplied`.
  if (input.hasOutboundMessage) {
    return { send: false, reason: "already_answered" };
  }

  // 6. The delay must be one we can actually honour.
  if (!isDelaySupported(config.delay)) {
    return { send: false, reason: "delay_unsupported" };
  }

  // 7. Schedule, evaluated in the workspace's own timezone.
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
 * Both use the in-memory limiter in lib/rate-limit.ts, which is per serverless
 * instance. Under fan-out the true ceiling is (instances × limit), so treat
 * these as a safety valve rather than a guarantee — a shared Redis store would
 * make them exact.
 */
export function checkAutoReplyRateLimits(
  workspaceId: number,
  recipient: string,
): { ok: true } | { ok: false; scope: "workspace" | "recipient" } {
  const perWorkspace = rateLimit(`autoreply:ws:${workspaceId}`, {
    max: 60,
    windowMs: 60 * 60 * 1000,
  });
  if (!perWorkspace.ok) return { ok: false, scope: "workspace" };

  const to = recipient.trim().toLowerCase();
  // At most one acknowledgement to the same person in 10 minutes…
  const burst = rateLimit(`autoreply:to10:${workspaceId}:${to}`, {
    max: 1,
    windowMs: 10 * 60 * 1000,
  });
  if (!burst.ok) return { ok: false, scope: "recipient" };
  // …and at most three in an hour, so a slow loop can't tick along all day.
  const hourly = rateLimit(`autoreply:to60:${workspaceId}:${to}`, {
    max: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!hourly.ok) return { ok: false, scope: "recipient" };

  return { ok: true };
}
