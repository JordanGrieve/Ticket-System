import type { SubscriberStatus } from "@/db/schema";

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

/** One row as it comes out of the list/segment join, before any filtering. */
export type AudienceCandidate = {
  subscriberId: number;
  email: string;
  name: string | null;
  status: SubscriberStatus;
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
  | "suppressed"
  | "unsubscribed"
  | "bounced"
  | "complained";

export const AUDIENCE_SKIP_REASONS: AudienceSkipReason[] = [
  "invalid_email",
  "duplicate",
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
    suppressed: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
  };
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

    if (suppressed.has(email)) {
      skipped.suppressed += 1;
      continue;
    }

    if (c.status !== "subscribed") {
      // Every non-subscribed status maps to its own counter. The switch is
      // exhaustive so adding a SubscriberStatus fails the build here rather
      // than silently becoming a send.
      switch (c.status) {
        case "unsubscribed":
          skipped.unsubscribed += 1;
          break;
        case "bounced":
          skipped.bounced += 1;
          break;
        case "complained":
          skipped.complained += 1;
          break;
        default: {
          const exhaustive: never = c.status;
          throw new Error(`Unhandled subscriber status: ${String(exhaustive)}`);
        }
      }
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
function unsubscribeFooterText(url: string): string {
  return `\n\n—\nDon't want these emails? Unsubscribe: ${url}`;
}

function unsubscribeFooterHtml(url: string): string {
  const safe = escapeHtml(url);
  return `<p style="margin:28px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#a49a89;">Don&rsquo;t want these emails? <a href="${safe}" style="color:#a49a89;">Unsubscribe</a>.</p>`;
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

  const text = bodyText + unsubscribeFooterText(input.unsubscribeUrl);

  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>\n`
    : "";
  const inner =
    textToHtmlParagraphs(bodyText) + unsubscribeFooterHtml(input.unsubscribeUrl);

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
