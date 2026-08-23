import type {
  AutoReplyDelay,
  AutoReplySchedule,
  BusinessHours,
  TicketSource,
} from "@/db/schema";
import {
  DEFAULT_BUSINESS_HOURS,
  isWithinBusinessHours,
} from "./business-hours";

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
 *
 * "Pure" now also means CONFIG-FREE, which this file only claimed to be. The
 * settings screen is a client component, and the self-address guard's import of
 * lib/config was shipping the whole config module — env reads and all — into
 * the browser bundle. The guards and the decision chain moved to
 * lib/auto-reply-guards.ts for that reason; see its header. Nothing below may
 * import lib/config, or lib/tickets, or anything else that reaches them.
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

// ── Deferral (out-of-hours) ──────────────────────────────────────

/**
 * How far ahead we are willing to hold an acknowledgement.
 *
 * Eight days rather than seven: a window on a single weekday must still be
 * findable from any moment in the week, and seven days exactly makes the
 * boundary case a coin toss. Anything that needs longer than this means the
 * window is effectively "never", and holding a customer's acknowledgement for
 * a fortnight is not deferral, it is loss with extra steps.
 */
export const DEFERRAL_HORIZON_DAYS = 8;

/**
 * A deferred acknowledgement that missed its window this badly is dropped
 * rather than sent. Twelve hours means an ordinary outage of the sweep (which
 * is best-effort GitHub Actions — see .github/workflows) still delivers, while
 * a sweep that was dead for two days does not wake up and mail everybody an
 * acknowledgement for enquiries they have long since had a human answer to.
 */
export const DEFERRAL_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
/** Coarse scan step. Any window edge is found within this, then refined. */
const COARSE_STEP_MINUTES = 15;

/**
 * The next instant at which `hours` is open, or null if there isn't one.
 *
 * ── WHY IT SCANS INSTEAD OF DOING ARITHMETIC ──
 *
 * The obvious implementation adds days and hours to a Date. That is wrong
 * twice a year and wrong permanently for half-hour zones: 09:00 local is not
 * a fixed number of milliseconds away from any given instant, because the
 * offset in between may change. The evaluator we must agree with —
 * `isWithinBusinessHours` — never does offset arithmetic either; it asks Intl
 * what the wall clock reads in the zone.
 *
 * So this walks forward asking that same question. Fifteen-minute steps until
 * the answer becomes "open" (at most ~770 checks over the horizon), then one
 * minute at a time backwards to find the exact opening minute. The result is
 * therefore consistent with the evaluator BY CONSTRUCTION, including across a
 * DST transition and on a window that wraps midnight, rather than by a second
 * implementation of the same rules that has to be kept in step.
 *
 * Returns null when: no usable window, `now` is already inside one (there is
 * nothing to defer — send it), or nothing opens within the horizon.
 */
export function nextBusinessHoursOpening(
  now: Date,
  hours: BusinessHours | null | undefined,
  timeZone: string,
): Date | null {
  if (!hours || !Array.isArray(hours.days) || hours.days.length === 0) {
    return null;
  }
  if (isWithinBusinessHours(now, hours, timeZone)) return null;

  // Start from the next whole minute: due times are minute-granular, and
  // starting mid-minute would make the refinement below return a moment a few
  // seconds before the window it claims to be the start of.
  const startMs = Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const horizonMs = startMs + DEFERRAL_HORIZON_DAYS * 24 * 60 * MINUTE_MS;

  for (
    let ms = startMs;
    ms <= horizonMs;
    ms += COARSE_STEP_MINUTES * MINUTE_MS
  ) {
    if (!isWithinBusinessHours(new Date(ms), hours, timeZone)) continue;

    // Inside. Walk back to the first minute that is still inside — never past
    // `startMs`, and never more than one coarse step, because the previous
    // coarse probe was outside.
    let openAt = ms;
    for (let i = 0; i < COARSE_STEP_MINUTES; i += 1) {
      const earlier = openAt - MINUTE_MS;
      if (earlier < startMs) break;
      if (!isWithinBusinessHours(new Date(earlier), hours, timeZone)) break;
      openAt = earlier;
    }
    return new Date(openAt);
  }

  return null;
}

/**
 * Should an enquiry suppressed by the schedule be HELD, and until when?
 *
 * Only `business_hours` defers, and the asymmetry is the point:
 *
 *  • `business_hours` means "acknowledge people while we're open". An enquiry
 *    at 21:00 is exactly the case the client had in mind, and dropping it is
 *    the bug this function exists to fix. Held until 09:00.
 *  • `out_of_hours` means "acknowledge people ONLY when we're closed" — an
 *    after-hours "we're not here" notice. Suppression happens when we are
 *    OPEN, i.e. when a human is available to answer properly. Holding that
 *    message until the office closes so a customer receives "we're closed"
 *    hours after they were already helped would be worse than silence.
 *  • `always` never suppresses on schedule at all.
 *
 * Returns null when there is nothing to hold for: wrong mode, no usable
 * window, or nothing opening inside the horizon. The caller must treat null as
 * "this really is dropped" and say so.
 *
 * Pure, and shared with the settings screen on purpose: the sentence the
 * client reads about what happens tonight is computed by the same code that
 * decides it.
 */
export function planDeferral(
  config: Pick<
    AutoReplyConfig,
    "scheduleMode" | "businessHours" | "timezone"
  >,
  now: Date,
): Date | null {
  if (config.scheduleMode !== "business_hours") return null;
  return nextBusinessHoursOpening(now, config.businessHours, config.timezone);
}

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

// selfAddresses / isSelfAddress moved to lib/auto-reply-guards.ts: they need
// EMAIL_FROM_ADDRESS and INBOUND_DOMAIN, and config must not reach the client.
// The header predicates below need nothing, so they stay where their tests and
// the inbound route already look for them.

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
  // The `not` segment must be OPTIONAL. It previously read `no?t?` without the
  // surrounding group being optional, which still required a second literal
  // "n" — so this only ever matched the doubled "donotreply" shape, and
  // noreply2@, noreplies@, no-replies@ and no-reply-2@ all fell through. Plain
  // noreply@ and no-reply@ were caught only because they are in the literal set
  // above. Every miss is a live autoresponder, and every live autoresponder is
  // a mail loop.
  if (/^(no|do)[-_.]?(?:no?t?[-_.]?)?repl(y|ies)/.test(base)) return true;
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

// EMAIL_RE, decideAutoReply and checkAutoReplyRateLimits moved to
// lib/auto-reply-guards.ts. decideAutoReply calls isSelfAddress, so it needs
// config too; the rate limiter is server-side machinery that had no business
// in a client bundle either. Both are re-exported nowhere on purpose — a
// re-export here would drag config straight back in.
