import type { SubscriberStatus, SuppressionReason } from "@/db/schema";

/**
 * Newsletter engine — the PURE half.
 *
 * Nothing in this file touches the database, the network, or `process.env`.
 * That is deliberate and load-bearing in three ways:
 *
 *  1. The campaign composer's live preview must run the *same* renderer the
 *     send path runs. A preview that lies about what 40,000 people will
 *     receive is worse than no preview at all.
 *  2. The tests import it with no DATABASE_URL. `db/index.ts` throws at import
 *     time when DATABASE_URL is unset, so anything that reaches it is
 *     untestable in CI.
 *  3. It must stay importable from a client component. It therefore imports
 *     NOTHING from `lib/config` — not directly and not transitively. Config
 *     reads non-NEXT_PUBLIC_ env vars, which do not exist in the browser; the
 *     one time that import crossed the boundary it threw on every authed page.
 *     Server-only values (the app URL, the unsubscribe mailto address) are
 *     PASSED IN as arguments here, never read.
 *
 * (3) is also why `renderTemplate` below is a near-duplicate of the one in
 * lib/auto-reply.ts rather than an import: that module pulls in lib/config,
 * lib/tickets and lib/rate-limit. The duplication is the cheaper of the two
 * mistakes. Behaviour is intentionally identical; if one changes, change both.
 *
 * The IO half — audience materialisation and the send loop — is in
 * lib/campaign-send.ts.
 */

// ── Field limits ─────────────────────────────────────────────────

export const CAMPAIGN_NAME_MAX = 80;
/**
 * Long subjects are truncated by every major client somewhere around 70
 * characters, but truncation is a display choice and 150 is where providers
 * start rejecting. We cap at the storage limit, not the aesthetic one, and let
 * the composer warn about the aesthetic one.
 */
export const CAMPAIGN_SUBJECT_MAX = 150;
export const CAMPAIGN_PREHEADER_MAX = 150;
export const CAMPAIGN_BODY_MAX = 50_000;

/**
 * Layout keys. `campaigns.templateKey` stores one of these, never rendered
 * HTML: a stored blob freezes a campaign against every future fix to the
 * layout, and makes "why does this render wrong in Outlook" unanswerable.
 */
export const TEMPLATE_KEYS = ["plain", "branded"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function isTemplateKey(value: unknown): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value as string);
}

// ── Merge tokens ─────────────────────────────────────────────────

export type NewsletterTokenName =
  | "first_name"
  | "name"
  | "email"
  | "company"
  | "unsubscribe_url";

export const NEWSLETTER_MERGE_TOKENS: {
  name: NewsletterTokenName;
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
    name: "name",
    token: "{name}",
    label: "Full name",
    hint: "The whole name as we hold it, or “there”",
  },
  {
    name: "email",
    token: "{email}",
    label: "Email",
    hint: "The address this copy is going to",
  },
  {
    name: "company",
    token: "{company}",
    label: "Company",
    hint: "Your workspace name",
  },
  {
    name: "unsubscribe_url",
    token: "{unsubscribe_url}",
    label: "Unsubscribe link",
    hint: "Per-recipient. A footer link is added even if you omit this",
  },
];

/** Same neutral placeholder as the auto-reply engine, for the same reasons. */
export const UNKNOWN_FIRST_NAME = "there";

/**
 * Extract a usable first name, or the fallback.
 *
 * Marketing lists are dirtier than ticket contacts: CSV imports routinely put
 * the address in the name column, or "N/A", or the empty string. A subscriber
 * must never be greeted "Hi bob.smith@acme.co," — that is the tell of a spam
 * blast, and it is exactly what trains a recipient to hit the complaint button
 * that costs every other tenant on this domain their inbox placement.
 */
export function firstNameFrom(
  name: string | null | undefined,
  email?: string | null,
): string {
  const raw = (name ?? "").trim();
  if (!raw) return UNKNOWN_FIRST_NAME;
  if (raw.includes("@")) return UNKNOWN_FIRST_NAME;
  if (email && raw.toLowerCase() === email.trim().toLowerCase()) {
    return UNKNOWN_FIRST_NAME;
  }

  const first = raw
    .split(/\s+/)[0]
    .replace(/^["'`(<[]+/, "")
    .replace(/["'`)>\].,;:!?]+$/, "")
    .trim();
  if (first.length < 2) return UNKNOWN_FIRST_NAME;
  if (/[0-9/\\|]/.test(first)) return UNKNOWN_FIRST_NAME;

  if (first === first.toUpperCase()) {
    return first[0] + first.slice(1).toLowerCase();
  }
  if (first === first.toLowerCase()) {
    return first[0].toUpperCase() + first.slice(1);
  }
  return first;
}

/** Whole name, cleaned. Falls back to the same placeholder as first_name. */
export function fullNameFrom(
  name: string | null | undefined,
  email?: string | null,
): string {
  const raw = (name ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return UNKNOWN_FIRST_NAME;
  if (raw.includes("@")) return UNKNOWN_FIRST_NAME;
  if (email && raw.toLowerCase() === email.trim().toLowerCase()) {
    return UNKNOWN_FIRST_NAME;
  }
  return raw;
}

export type MergeValues = Record<string, string>;

export function buildCampaignMergeValues(input: {
  name: string | null | undefined;
  email: string;
  workspaceName: string;
  /** Absolute URL. Built by the caller — this module never knows APP_URL. */
  unsubscribeUrl: string;
}): MergeValues {
  return {
    first_name: firstNameFrom(input.name, input.email),
    name: fullNameFrom(input.name, input.email),
    email: input.email.trim(),
    company: input.workspaceName.trim() || "our team",
    unsubscribe_url: input.unsubscribeUrl,
  };
}

/**
 * Substitute merge tokens.
 *
 * Two hard rules, unchanged from the auto-reply renderer:
 *  1. no `{anything}` survives into the output — a misspelled or unknown token
 *     (`{firstname}`, `{order_id}`) is deleted, never passed through. 40,000
 *     people reading a literal `{first_name}` is an unrecoverable send;
 *  2. the result is tidied so a deleted token doesn't leave "Hi ," behind.
 *
 * Newlines survive; only runs of spaces/tabs within a line collapse. URLs are
 * substituted verbatim and are not touched by the tidy pass.
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
        .replace(/[ \t]+([,.!?;:])/g, "$1")
        .replace(/[ \t]+$/g, ""),
    )
    .join("\n")
    .trim();
}

// ── Addresses ────────────────────────────────────────────────────

/**
 * Canonical form for comparing two addresses.
 *
 * Lower-cased and trimmed, and NOTHING else. In particular we do not strip
 * `+tags` or dots from the local part: RFC 5321 makes the local part the
 * receiving server's business, and "helpfully" folding a+news@x.com into
 * a@x.com would collapse two distinct mailboxes — which in a suppression check
 * means silently mailing someone who asked us not to, and in a dedup check
 * means dropping a subscriber who did ask us to.
 *
 * The domain half is genuinely case-insensitive, the local half is not, but
 * every mainstream provider treats it as such and preserving case here would
 * make suppressions miss on a capitalised re-import. Folding the whole address
 * is the choice that fails safe.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Light sanity check. Mirrors lib/http.isValidEmail; kept local to stay pure. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Audience selection ───────────────────────────────────────────

/**
 * One row as it comes out of the list/segment join, before any filtering.
 *
 * `consentAt` is REQUIRED here, not optional, even though the column is
 * nullable. A caller that forgets to select it would otherwise compile, and
 * `undefined` would be read as "no consent" — which fails safe (nobody is
 * mailed) but fails silently, and a composer reporting 0 recipients with no
 * explanation is a bug that takes an afternoon to find. Making the field
 * mandatory moves that afternoon to a build error.
 */
export type AudienceCandidate = {
  subscriberId: number;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  /**
   * When marketing consent was captured, or null when we have no record.
   * Null is not "probably fine" — see hasMarketingConsent below.
   */
  consentAt: Date | null;
};

/** Someone we will actually create a campaign_recipients row for. */
export type AudienceMember = {
  subscriberId: number;
  /** Normalised. Frozen onto the recipient row at materialisation time. */
  email: string;
  name: string | null;
};

export type AudienceSkipReason =
  | "invalid_email"
  | "duplicate"
  | "no_consent"
  | "suppressed"
  | "unsubscribed"
  | "bounced"
  | "complained";

/** Evaluation order, and therefore display order. See selectAudience. */
export const AUDIENCE_SKIP_REASONS: AudienceSkipReason[] = [
  "invalid_email",
  "duplicate",
  "no_consent",
  "suppressed",
  "unsubscribed",
  "bounced",
  "complained",
];

export type AudienceSelection = {
  members: AudienceMember[];
  /** Every reason, always present, so the UI never has to guess a zero. */
  skipped: Record<AudienceSkipReason, number>;
  skippedTotal: number;
  candidateCount: number;
};

function emptySkips(): Record<AudienceSkipReason, number> {
  return {
    invalid_email: 0,
    duplicate: 0,
    no_consent: 0,
    suppressed: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
  };
}

/**
 * ── THE CONSENT RULE, IN ONE PLACE ──
 *
 * A subscriber may be mailed only if we hold a consent timestamp. No timestamp,
 * no send — and emphatically not "no timestamp, but the row says 'subscribed'".
 *
 * `status = 'subscribed'` is a statement about our list, not about permission.
 * It is set by default on every INSERT (see db/schema.ts), so an import that
 * arrived as a bare column of addresses — a scraped list, a bought list, a
 * spreadsheet someone found — lands as 'subscribed' with no provenance at all
 * and is indistinguishable from a double opt-in signup by status alone. The
 * consent columns are the only thing that tells them apart, which is why the
 * schema forbids backfilling them.
 *
 * Null therefore means "we cannot show a regulator anything", and that is a
 * refusal, not a default. Under GDPR/PECR the controller must be able to
 * demonstrate consent; an address we cannot demonstrate consent for is one we
 * have no lawful basis to mail, and "the client said it was fine" is a defence
 * only where it was contractually warranted and recorded.
 *
 * Deliberately does NOT look at consentMethod or consentSource. Those describe
 * the consent; this asks whether there is one. A row with a method and no
 * timestamp is a half-written record, and treating it as consent would let a
 * partial import through the only gate that exists.
 */
export function hasMarketingConsent(
  consentAt: Date | null | undefined,
): boolean {
  return consentAt instanceof Date && !Number.isNaN(consentAt.getTime());
}

/**
 * ── THE SUPPRESSION RULE, IN ONE PLACE ──
 *
 * `suppressions` is AUTHORITATIVE. It outranks `subscribers.status` in every
 * direction, and this function is the only place that decision is expressed:
 * everything else — the audience preview, materialisation, the send loop, the
 * status reconciliation sweep — either calls this or mirrors it in SQL.
 *
 * Why it has to outrank status rather than merely agree with it: the two are
 * written by different events and drift. A bounce webhook writes a suppression
 * row AND sets `status = 'bounced'`; a re-imported CSV overwrites the status
 * back to 'subscribed' and cannot touch the suppression, because suppressions
 * are keyed by EMAIL and survive the subscriber row being deleted and
 * re-created. So whenever the two disagree, the subscriber row is the stale
 * one, by construction.
 *
 * Failing the other way — believing a 'subscribed' row over a suppression —
 * means mailing an address that hard-bounced or reported us for spam. On a
 * shared sending domain that is charged to every other tenant's transactional
 * support mail.
 *
 * Pure and total, so the precedence can be proved in tests/suppression*.test.ts
 * without a database.
 */
export type Sendability =
  | { sendable: true }
  | { sendable: false; reason: AudienceSkipReason };

export function sendability(
  status: SubscriberStatus,
  suppressed: boolean,
): Sendability {
  // Checked FIRST, and not as an else-branch of the status test: a suppressed
  // address is blocked whatever the subscriber row claims about itself.
  if (suppressed) return { sendable: false, reason: "suppressed" };

  if (status === "subscribed") return { sendable: true };

  // Each non-subscribed status keeps its own reason. They mean different things
  // to whoever reads the report: `unsubscribed` is the client's own doing,
  // `bounced`/`complained` is deliverability damage they need to see.
  switch (status) {
    case "unsubscribed":
      return { sendable: false, reason: "unsubscribed" };
    case "bounced":
      return { sendable: false, reason: "bounced" };
    case "complained":
      return { sendable: false, reason: "complained" };
    default: {
      // Exhaustive: adding a SubscriberStatus fails the build here rather than
      // silently becoming a send.
      const exhaustive: never = status;
      throw new Error(`Unhandled subscriber status: ${String(exhaustive)}`);
    }
  }
}

/**
 * The subscriber status a suppression implies.
 *
 * Used by the reconciliation sweep that drags `subscribers.status` back into
 * line with `suppressions` after the two have disagreed. It only ever moves a
 * subscriber from 'subscribed' to a blocked status — never the reverse, and
 * never between two blocked statuses, because a 'complained' row is evidence
 * and downgrading it to 'unsubscribed' destroys the record of why the address
 * is blocked.
 */
export function statusForSuppressionReason(
  reason: SuppressionReason,
): SubscriberStatus {
  switch (reason) {
    case "hard_bounce":
      return "bounced";
    case "complaint":
      return "complained";
    case "manual":
      return "unsubscribed";
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled suppression reason: ${String(exhaustive)}`);
    }
  }
}

/**
 * Cheap shape check on an unsubscribe token, before it reaches the database.
 *
 * Deliberately LENIENT — the database lookup is the real authority and the
 * token space (128 bits from generateUnsubscribeToken) is not something a
 * regex is defending. This exists only to keep obvious junk and path noise out
 * of a query, and to bound the length of an attacker-supplied string. Making
 * it strict would risk rejecting a token already sitting in somebody's inbox,
 * and an unsubscribe that rejects a real token is a legal breach, not a bug.
 */
export function looksLikeUnsubscribeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(token);
}

/**
 * Turn raw list membership into the people we may lawfully and safely mail.
 *
 * ── Order of operations, and why ──
 *
 * DEDUPLICATION HAPPENS FIRST. A campaign may draw from several overlapping
 * lists ("All customers" ∪ "Newsletter" ∪ "Beta testers"), and the same human
 * can appear in all three — twice by subscriber id, and again under a second
 * subscriber row carrying the same address in different case. If filtering ran
 * first, one person suppressed and present three times would be counted as
 * three suppressions, and the composer would tell the client they were about
 * to skip 300 people when the real figure is 100. Dedup first means every
 * count below is a count of PEOPLE.
 *
 * Dedup is by subscriber id AND by normalised email. The id alone is not
 * enough: `subscribers` is unique on (workspace_id, email), which is
 * case-sensitive at the index level, so "Bob@x.com" and "bob@x.com" are two
 * legitimate rows pointing at one mailbox. Sending both is a duplicate send to
 * a real person, which is the single most reliable way to earn a complaint.
 *
 * CONSENT IS CHECKED BEFORE EVERYTHING EXCEPT DEDUP, AND OUTRANKS SUPPRESSION.
 * Someone can easily be both unconsented and suppressed, and only one reason
 * gets reported. It is `no_consent`, for a reason that is about backstops
 * rather than about which sin is graver:
 *
 *   Suppression is enforced three more times in SQL after this function runs —
 *   the materialising INSERT's LEFT JOIN, the retirement sweep, and the claim
 *   UPDATE's NOT EXISTS (see lib/campaign-send.ts). Mis-attributing a
 *   suppressed person to another bucket here costs a number on a report and
 *   changes who is mailed by exactly nobody.
 *
 *   Consent has NO backstop anywhere. There is no column on
 *   campaign_recipients, no predicate in the INSERT, no sweep. This function is
 *   the only place in the codebase where a missing consent record stops a send,
 *   so its count is the only signal the operator will ever get.
 *
 * Bury an unconsented address inside the `suppressed` tally and the composer
 * shows `no_consent: 0` — which reads as "this list is fully consented", the
 * single most dangerous false statement this screen can make. The reverse
 * mistake merely under-reports deliverability damage that three SQL predicates
 * are still enforcing.
 *
 * It runs AFTER dedup for the same reason everything else does: so the number
 * is a count of people, not of list memberships.
 *
 * SUPPRESSION BEATS STATUS. `suppressions` is keyed by email, not subscriber
 * id, precisely so it still bites for an address that was deleted and re-added
 * or that never had a subscribers row at all. A row here is a hard block —
 * hard bounce, spam complaint, or a human decision — and it wins over anything
 * the subscriber record claims about itself, including `status = 'subscribed'`
 * set by a fresh import. Re-importing a CSV must not resurrect someone who
 * reported us for spam.
 *
 * The remaining statuses are separated rather than lumped into "not
 * subscribed" because they mean different things to whoever reads the report:
 * `unsubscribed` is the client's own doing, `bounced`/`complained` is
 * deliverability damage they need to see.
 *
 * @param candidates raw join output; may contain duplicates in any order
 * @param suppressedEmails every suppression for THIS workspace. The caller is
 *   responsible for scoping it — passing another tenant's set here would block
 *   the wrong people, and passing an unscoped set would leak the existence of
 *   another tenant's suppressions through the skip counts.
 */
export function selectAudience(
  candidates: readonly AudienceCandidate[],
  suppressedEmails: Iterable<string>,
): AudienceSelection {
  const suppressed = new Set<string>();
  for (const e of suppressedEmails) suppressed.add(normaliseEmail(e));

  const skipped = emptySkips();
  const members: AudienceMember[] = [];

  const seenIds = new Set<number>();
  const seenEmails = new Set<string>();

  for (const c of candidates) {
    const email = normaliseEmail(c.email ?? "");

    // Malformed addresses are dropped before dedup: they are not a person, so
    // counting a second copy of the same junk as a "duplicate" would be a lie.
    if (!email || !looksLikeEmail(email)) {
      skipped.invalid_email += 1;
      continue;
    }

    if (seenIds.has(c.subscriberId) || seenEmails.has(email)) {
      skipped.duplicate += 1;
      continue;
    }
    seenIds.add(c.subscriberId);
    seenEmails.add(email);

    // Before any question about deliverability: may we lawfully mail this
    // person at all? Checked ahead of `sendability` because this is the only
    // consent gate that exists, while suppression has three more in SQL — the
    // full argument is in the header above.
    if (!hasMarketingConsent(c.consentAt)) {
      skipped.no_consent += 1;
      continue;
    }

    // Suppression-beats-status is not decided here: `sendability` owns that
    // rule so the preview, the write path and the send loop cannot drift apart
    // by each re-implementing it.
    const verdict = sendability(c.status, suppressed.has(email));
    if (!verdict.sendable) {
      skipped[verdict.reason] += 1;
      continue;
    }

    members.push({
      subscriberId: c.subscriberId,
      email,
      name: c.name,
    });
  }

  const skippedTotal = AUDIENCE_SKIP_REASONS.reduce(
    (sum, r) => sum + skipped[r],
    0,
  );

  return {
    members,
    skipped,
    skippedTotal,
    candidateCount: candidates.length,
  };
}

// ── Unsubscribe ──────────────────────────────────────────────────

/**
 * The public unsubscribe URL for one recipient row.
 *
 * `appUrl` is passed in, not read from lib/config — see the file header. The
 * token is the per-recipient secret from campaign_recipients; it is the ONLY
 * thing standing between a stranger and unsubscribing anybody, so it must come
 * from generateUnsubscribeToken() and never be derived from an id or address.
 */
export function unsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/u/${encodeURIComponent(token)}`;
}

/**
 * List-Unsubscribe / List-Unsubscribe-Post headers.
 *
 * Gmail and Yahoo require one-click unsubscribe (RFC 8058) from bulk senders.
 * The rules that make it *work* rather than merely be present:
 *
 *  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is what makes the
 *    HTTPS entry one-click. Without it the header is just a hint and mail
 *    clients keep showing the complaint button as the easier option.
 *  - The URL it names MUST accept an unauthenticated POST and act on it
 *    immediately. Mail providers POST it themselves; a page that requires a
 *    confirmation click is a non-compliant unsubscribe, and the provider's
 *    fallback for "unsubscribe didn't work" is the spam button.
 *  - The mailto entry is listed first for the benefit of older clients that
 *    take the first entry only, but it is the HTTPS one that satisfies RFC
 *    8058. Omit the mailto entirely if no address is monitored: a
 *    List-Unsubscribe pointing at an unread mailbox is worse than none.
 */
export function listUnsubscribeHeaders(input: {
  url: string;
  mailto?: string | null;
}): Record<string, string> {
  const entries: string[] = [];
  if (input.mailto) entries.push(`<mailto:${input.mailto}>`);
  entries.push(`<${input.url}>`);
  return {
    "List-Unsubscribe": entries.join(", "),
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// ── Rendering ────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

/** The campaign fields the renderer needs. A subset of the `campaigns` row. */
export type RenderableCampaign = {
  subject: string;
  preheader: string | null;
  templateKey: string;
  body: string;
};

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

/**
 * Who the law says this message is from.
 *
 * `workspaceName` is always known. The other two come from the `workspaces`
 * row and are nullable on purpose (db/schema.ts): a fake postal address in a
 * real marketing email is worse than not sending at all, because it is an
 * affirmative falsehood in the one field the statute is about. So the schema
 * refuses to guess, and the send refuses to proceed.
 */
export type SenderIdentity = {
  workspaceName: string;
  /** Registered or trading name. Falls back to workspaceName for display. */
  legalName: string | null;
  /** Physical postal address. Null means this workspace cannot send. */
  postalAddress: string | null;
};

/**
 * The gate. Returns the identity when it is lawful to send, or null.
 *
 * Callers must check this BEFORE claiming recipient rows — claim-before-send
 * means a row claimed and then abandoned is an email nobody receives and
 * nobody retries. Refusing the whole batch up front costs nothing and loses
 * no one.
 */
export function mailableSender(
  sender: SenderIdentity,
): SenderIdentity | null {
  return (sender.postalAddress ?? "").trim() ? sender : null;
}

/**
 * Footer appended to EVERY campaign, in both parts, regardless of what the
 * author wrote.
 *
 * A visible unsubscribe link is not optional — CAN-SPAM requires it, GDPR
 * requires the withdrawal to be as easy as the consent, and Gmail's bulk
 * sender rules expect it alongside the header. Making it a template the client
 * can edit means one client eventually deletes it and the deliverability
 * damage lands on every other tenant sharing the sending domain. So it is
 * appended by the renderer and there is no setting to turn it off.
 *
 * If the author *also* used {unsubscribe_url} in the body, they get two links.
 * That is the correct trade: a duplicated link is untidy, a missing one is
 * unlawful.
 */
function unsubscribeFooterText(url: string, sender: SenderIdentity): string {
  return `\n\n—\nDon't want these emails? Unsubscribe: ${url}\n\n${senderBlockText(
    sender,
  )}`;
}

function unsubscribeFooterHtml(url: string, sender: SenderIdentity): string {
  const safe = escapeHtml(url);
  const identity = escapeHtml(senderBlockText(sender)).replace(/\n/g, "<br />");
  return `<p style="margin:28px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#a49a89;">Don&rsquo;t want these emails? <a href="${safe}" style="color:#a49a89;">Unsubscribe</a>.</p>
<p style="margin:10px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#a49a89;">${identity}</p>`;
}

/**
 * Who sent this, and from where — the CAN-SPAM identification block.
 *
 * The statute wants a valid PHYSICAL postal address in every commercial
 * message. `mailableSender()` is what guarantees there is one; this function
 * only formats it, and throws rather than emitting a footer without one,
 * because a footer that silently omits the address is the exact failure the
 * gate exists to prevent.
 *
 * The name falls back to the workspace name when no legal name is recorded.
 * That is a presentation fallback, not an invention: the workspace name is
 * what the client typed for themselves, and it is already the From name on
 * this message.
 */
function senderBlockText(sender: SenderIdentity): string {
  const address = (sender.postalAddress ?? "").trim();
  if (!address) {
    throw new Error(
      "renderCampaign: no postal address. A commercial message may not be " +
        "built without one — gate the send with mailableSender() first.",
    );
  }
  const name = (sender.legalName ?? "").trim() || sender.workspaceName.trim();
  // Single-line: a multi-line address pasted by the client is normalised to
  // comma separation so it reads as an address rather than as body copy.
  const oneLine = address
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
  return name ? `${name}, ${oneLine}` : oneLine;
}

/**
 * Turn authored plain text into HTML paragraphs.
 *
 * The body is authored as text, not HTML, so the escape here is total: a
 * subscriber name containing `<script>` or a client pasting raw markup cannot
 * inject anything into what other people receive. Bare URLs are linkified
 * AFTER escaping, so the href can only ever contain characters that survived
 * the escape.
 */
function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const escaped = escapeHtml(block).replace(/\n/g, "<br />");
      const linked = escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" style="color:#d6552f;">${url}</a>`,
      );
      return `<p style="margin:0 0 16px;font:400 14.5px/1.65 Arial,sans-serif;color:#3c372f;">${linked}</p>`;
    })
    .join("\n");
}

/**
 * Render one campaign for one recipient.
 *
 * Pure: the same inputs always give the same bytes, which is what lets the
 * composer preview and the (future) send loop agree.
 *
 * The preheader is emitted as a hidden div at the top of the HTML — the inbox
 * preview line after the subject. Without one, clients scrape the first
 * visible text, which is usually the greeting, so every campaign in the list
 * previews as "Hi there,".
 */
export function renderCampaign(input: {
  campaign: RenderableCampaign;
  recipient: { email: string; name: string | null };
  workspaceName: string;
  unsubscribeUrl: string;
  /**
   * Required. Throws when it carries no postal address — see senderBlockText.
   * Callers gate with mailableSender() before claiming any recipient row.
   */
  sender: SenderIdentity;
}): RenderedEmail {
  const values = buildCampaignMergeValues({
    name: input.recipient.name,
    email: input.recipient.email,
    workspaceName: input.workspaceName,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  const subject = renderTemplate(input.campaign.subject, values);
  const bodyText = renderTemplate(input.campaign.body, values);
  const preheader = input.campaign.preheader
    ? renderTemplate(input.campaign.preheader, values)
    : "";

  const sender: SenderIdentity = {
    ...input.sender,
    workspaceName: input.workspaceName,
  };

  const text = bodyText + unsubscribeFooterText(input.unsubscribeUrl, sender);

  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>\n`
    : "";
  const inner =
    textToHtmlParagraphs(bodyText) +
    unsubscribeFooterHtml(input.unsubscribeUrl, sender);

  const html =
    input.campaign.templateKey === "branded"
      ? brandedShell(hiddenPreheader, inner, input.workspaceName)
      : plainShell(hiddenPreheader, inner);

  return { subject, text, html };
}

function plainShell(preheader: string, inner: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;">
    ${preheader}<div style="max-width:560px;margin:0 auto;padding:28px 18px;">
${inner}
    </div>
  </body>
</html>`;
}

function brandedShell(
  preheader: string,
  inner: string,
  workspaceName: string,
): string {
  const name = escapeHtml(workspaceName);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f4;">
    ${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr><td style="padding:0 8px 18px;font:700 17px Arial,sans-serif;color:#26221d;">${name}</td></tr>
          <tr><td style="background:#ffffff;border:1px solid #e7e1d7;border-radius:16px;padding:32px;">
${inner}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ── Input normalisation ──────────────────────────────────────────

/** Collapse whitespace, trim, cap. Null when nothing usable is left. */
function normaliseLine(raw: unknown, max: number): string | null {
  const value = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return value || null;
}

export type CampaignDraftInput = {
  name: string;
  subject: string;
  preheader: string | null;
  templateKey: TemplateKey;
  body: string;
  listId: number | null;
};

export type CampaignInputResult =
  | { ok: true; value: CampaignDraftInput }
  | { ok: false; error: string };

/**
 * Validate a create-campaign body. Returns a message fit to show a client
 * rather than a field path — this is a small form, not an API for machines.
 */
export function parseCampaignInput(body: {
  name?: unknown;
  subject?: unknown;
  preheader?: unknown;
  templateKey?: unknown;
  body?: unknown;
  listId?: unknown;
}): CampaignInputResult {
  const name = normaliseLine(body.name, CAMPAIGN_NAME_MAX);
  if (!name) return { ok: false, error: "A campaign needs a name." };

  const subject = normaliseLine(body.subject, CAMPAIGN_SUBJECT_MAX);
  if (!subject) return { ok: false, error: "A campaign needs a subject line." };

  const preheader = normaliseLine(body.preheader, CAMPAIGN_PREHEADER_MAX);

  const templateKey = body.templateKey === undefined ? "plain" : body.templateKey;
  if (!isTemplateKey(templateKey)) {
    return { ok: false, error: "Unknown template." };
  }

  const rawBody = String(body.body ?? "").slice(0, CAMPAIGN_BODY_MAX);
  if (!rawBody.trim()) return { ok: false, error: "A campaign needs a body." };

  let listId: number | null = null;
  if (body.listId !== undefined && body.listId !== null) {
    const n = Number(body.listId);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, error: "Invalid audience list." };
    }
    listId = n;
  }

  return {
    ok: true,
    value: { name, subject, preheader, templateKey, body: rawBody, listId },
  };
}

/**
 * Which statuses may still be edited.
 *
 * A campaign stops being editable the moment recipients exist, not the moment
 * it finishes: changing the subject of a half-sent campaign means two
 * different emails went out under one name, and the report can no longer say
 * what anybody received.
 */
export function isEditableStatus(status: string): boolean {
  return status === "draft" || status === "scheduled";
}
