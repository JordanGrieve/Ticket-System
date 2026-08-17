import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  contacts,
  labels,
  ticketMessages,
  tickets,
  type LabelColor,
  type MessageDirection,
  type TicketSource,
  type TicketStatus,
} from "@/db/schema";

/**
 * Search across a workspace's tickets, message bodies, contacts and labels.
 *
 * ── TENANCY ──────────────────────────────────────────────────────
 * Search is the easiest place in this product to leak a tenant: one missing
 * predicate and a stranger's customer emails and message bodies come back in a
 * ranked list. So every statement below is built the same way:
 *
 *   - `tickets`, `contacts` and `labels` carry workspace_id and are filtered on
 *     it directly.
 *   - `ticket_messages` carries NO workspace_id. It is reached ONLY through an
 *     innerJoin up to `tickets` whose WHERE pins tickets.workspace_id — the
 *     join IS the tenant filter, exactly as in exportWorkspaceData.
 *   - the workspace predicate is the FIRST argument of every `and(...)`, so a
 *     future filter can only ever be ANDed onto it, never replace it.
 *
 * `searchQueries()` below is exported separately from `searchWorkspace()` so
 * the four statements can be rendered with `.toSQL()` and the emitted SQL read
 * directly, with no database and no connection. That is how these were
 * checked, rather than by reading the TypeScript and trusting it. The four
 * statements it currently emits, with terms ["refund","order"] and workspace 7:
 *
 *   tickets   … where ("tickets"."workspace_id" = $1 and (concat_ws(…) ILIKE $2 …))
 *   messages  … from "ticket_messages" inner join "tickets"
 *                 on "ticket_messages"."ticket_id" = "tickets"."id"
 *               where ("tickets"."workspace_id" = $1 and ("ticket_messages"."body" ILIKE $2 …))
 *   contacts  … where ("contacts"."workspace_id" = $2 and (concat_ws(…) ILIKE $3 …))
 *               with its count subquery carrying its own t.workspace_id = $1
 *   labels    … where ("labels"."workspace_id" = $2 and ("labels"."name" ILIKE $3 …))
 *               with its count subquery carrying its own t.workspace_id = $1
 *
 * Note in particular that Drizzle qualifies EVERY column in the joined
 * `messages` select ("ticket_messages"."body", not a bare "body"), and that
 * both correlated counts filter workspace_id themselves — the outer WHERE does
 * not reach into a subquery that selects FROM `tickets` afresh.
 *
 * ── WHY SUBSTRING MATCHING AND NOT POSTGRES FULL-TEXT ─────────────
 * FTS was the obvious candidate and was rejected on purpose:
 *
 *  1. There is no GIN index to hang it on. `tickets` and `ticket_messages` have
 *     no tsvector column and adding one is a migration this change cannot make.
 *     `to_tsvector(body) @@ websearch_to_tsquery(...)` computed per row is a
 *     sequential scan — the same scan ILIKE does, minus the simplicity. FTS
 *     without an index buys ranking and stemming, not speed.
 *  2. FTS tokenises badly for what people actually type into a support inbox.
 *     An address is one token, so "acme" does not match "jo@acme.com"; "TKT-48"
 *     and "ORD-99" split in ways plainto_tsquery will not put back together.
 *     Substring matching finds all of them.
 *  3. Suffix growth — the case stemming is usually sold on — mostly falls out
 *     of substring matching anyway: "refund" is a substring of "refunded",
 *     "refunds" and "refunding". What is genuinely lost is irregular stems
 *     ("ran" ⇄ "run") and relevance ranking. That is a real, small loss.
 *
 * Multi-word queries are handled by requiring EVERY term to appear somewhere in
 * the row's searchable text (AND, not phrase), which is what makes "refund
 * order" behave the way people expect.
 *
 * When a tenant's mail volume makes the scans hurt, the upgrade is an index,
 * not a rewrite: `CREATE EXTENSION pg_trgm` plus a GIN trigram index on the
 * same expressions makes these exact ILIKEs indexed, with no query change.
 */

/** Longest query we will look at. Anything beyond is noise or an attack. */
export const SEARCH_QUERY_MAX = 120;
/** Shortest query worth running — one character matches most of the corpus. */
export const SEARCH_QUERY_MIN = 2;
/** Terms beyond this are dropped; each one costs another ILIKE per row. */
export const SEARCH_TERMS_MAX = 6;
/** Rows returned per group. The true total is reported alongside. */
export const SEARCH_GROUP_LIMIT = 8;

// ── Pure helpers (no database) ───────────────────────────────────

export type ParsedQuery = {
  /** The cleaned query, as it should be echoed back into the input. */
  text: string;
  /** Lower-cased, de-duplicated terms. Empty when the query is unusable. */
  terms: string[];
};

/**
 * ASCII control characters out, spaces in.
 *
 * Written as a scan rather than a regex on purpose: a character class of
 * literal control codes is invisible in a diff and trips `no-control-regex`,
 * and this is the only place the query is normalised.
 */
function stripControlChars(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out;
}

/**
 * Clean a raw query string into terms.
 *
 * Control characters are stripped rather than escaped: they cannot usefully
 * appear in a subject or a body, and leaving them in makes the highlight
 * offsets below disagree with what the browser renders.
 */
export function parseSearchQuery(raw: unknown): ParsedQuery {
  const text = stripControlChars(String(raw ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_QUERY_MAX);

  if (text.length < SEARCH_QUERY_MIN) return { text, terms: [] };

  const terms = [...new Set(text.toLowerCase().split(" "))]
    .filter((t) => t.length > 0)
    .slice(0, SEARCH_TERMS_MAX);

  return { text, terms };
}

/**
 * Neutralise LIKE wildcards in a user term.
 *
 * Without this a query of "%" matches every row in the workspace, and "_"
 * silently matches any character. Paired with `ESCAPE '\'` in the statement.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A run of text, flagged if it is part of a term the user searched for. */
export type Segment = { text: string; hit: boolean };

/**
 * Split text into plain and matched runs so the UI can mark the hits without
 * ever building HTML from user content — the segments are rendered as React
 * children, so a subject containing `<script>` stays a string.
 */
export function highlightSegments(
  text: string,
  terms: string[],
  maxHits = 24,
): Segment[] {
  const active = terms.filter((t) => t.length > 0);
  if (text.length === 0) return [];
  if (active.length === 0) return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const out: Segment[] = [];
  let i = 0;
  let hits = 0;

  while (i < text.length && hits < maxHits) {
    // Earliest match wins; on a tie the longest term wins, so searching
    // "pay payment" marks "payment" whole rather than "pay" + "ment".
    let at = -1;
    let len = 0;
    for (const t of active) {
      const found = lower.indexOf(t, i);
      if (found === -1) continue;
      if (at === -1 || found < at || (found === at && t.length > len)) {
        at = found;
        len = t.length;
      }
    }
    if (at === -1) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + len), hit: true });
    i = at + len;
    hits++;
  }

  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/**
 * A window of `text` around its first hit, highlighted — "show me what
 * matched" rather than a bare subject line. Falls back to the opening of the
 * text when nothing matches (a ticket can match on its sender while its body
 * does not).
 */
export function snippetSegments(
  raw: string,
  terms: string[],
  width = 190,
): Segment[] {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0) return [];

  const lower = text.toLowerCase();
  let first = -1;
  for (const t of terms) {
    if (!t) continue;
    const at = lower.indexOf(t);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }

  // Some lead-in so the hit is read in context rather than at the very edge.
  let start = first === -1 ? 0 : Math.max(0, first - 48);
  if (start > 0) {
    // Nudge to the next word boundary so the snippet doesn't start mid-word.
    const space = text.indexOf(" ", start);
    if (space !== -1 && space - start < 20) start = space + 1;
  }
  let end = Math.min(text.length, start + width);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start + width - 28) end = space;
  }

  const segments = highlightSegments(text.slice(start, end), terms);
  if (start > 0) segments.unshift({ text: "…", hit: false });
  if (end < text.length) segments.push({ text: "…", hit: false });
  return segments;
}

/** Which of a set of named fields actually contain one of the terms. */
export function matchedFields(
  fields: Record<string, string | null | undefined>,
  terms: string[],
): string[] {
  const active = terms.filter((t) => t.length > 0);
  if (active.length === 0) return [];
  return Object.entries(fields)
    .filter(([, value]) => {
      const haystack = (value ?? "").toLowerCase();
      return haystack.length > 0 && active.some((t) => haystack.includes(t));
    })
    .map(([name]) => name);
}

// ── SQL fragments ────────────────────────────────────────────────

/**
 * Column references written out rather than interpolated as Drizzle columns.
 *
 * Drizzle renders `${table.column}` inside a raw sql`` fragment WITHOUT a table
 * qualifier in several positions — a bare `"body"` or `"email"`. Inside a join
 * or a correlated subquery that bare name binds to whichever table Postgres
 * resolves it against first, which has silently produced wrong data twice in
 * this codebase (see lib/labels.ts and the note in lib/data.ts
 * listContactsWithCounts). Every column that appears inside a fragment below is
 * therefore spelled out, so none of it depends on where the fragment lands.
 */
const T_ID = sql.raw('"tickets"."id"');
const T_SUBJECT = sql.raw('"tickets"."subject"');
const T_NAME = sql.raw('"tickets"."customer_name"');
const T_EMAIL = sql.raw('"tickets"."customer_email"');
const T_ORDER = sql.raw('"tickets"."order_id"');
const M_BODY = sql.raw('"ticket_messages"."body"');
const C_NAME = sql.raw('"contacts"."name"');
const C_EMAIL = sql.raw('"contacts"."email"');
const L_ID = sql.raw('"labels"."id"');
const L_NAME = sql.raw('"labels"."name"');

/**
 * Everything about a ticket a search should look at. `concat_ws` skips NULLs,
 * so an order-less ticket contributes nothing rather than a NULL that would
 * annihilate the whole expression. The synthetic "TKT-<id>" makes the reference
 * people actually quote to each other searchable.
 */
const TICKET_HAYSTACK = sql`concat_ws(' ', ${T_SUBJECT}, ${T_NAME}, ${T_EMAIL}, ${T_ORDER}, 'TKT-' || ${T_ID})`;
const CONTACT_HAYSTACK = sql`concat_ws(' ', ${C_NAME}, ${C_EMAIL})`;

/**
 * Every term must appear somewhere in `haystack` (AND, not phrase).
 *
 * ESCAPE '\' pairs with escapeLikeTerm so a query of "100%" is a literal
 * search for "100%" and not a match against every row.
 */
function everyTermMatches(haystack: SQL, terms: string[]): SQL {
  const clauses = terms.map(
    (t) => sql`${haystack} ILIKE ${`%${escapeLikeTerm(t)}%`} ESCAPE '\\'`,
  );
  return sql`(${sql.join(clauses, sql` AND `)})`;
}

/**
 * The true number of matches, taken over the window before LIMIT — so the UI
 * can say "8 of 41" honestly rather than counting the rows it happens to hold.
 */
const MATCH_TOTAL = sql<number>`(count(*) OVER ())::int`;

// ── Queries ──────────────────────────────────────────────────────

/**
 * The four statements, unexecuted.
 *
 * Split out from `searchWorkspace` so they can be rendered and inspected:
 *
 *   const q = searchQueries(1, ["refund"], 8);
 *   q.tickets.toSQL();   // → assert /"tickets"\."workspace_id" = \$/
 *   q.messages.toSQL();  // → assert the innerJoin AND the workspace filter
 *
 * A tenancy guard that reads the source is guessing; this reads the SQL.
 */
export function searchQueries(
  workspaceId: number,
  terms: string[],
  limit: number = SEARCH_GROUP_LIMIT,
) {
  return {
    // tickets carries workspace_id — filtered directly, first in the and().
    tickets: db
      .select({
        id: tickets.id,
        subject: tickets.subject,
        customerName: tickets.customerName,
        customerEmail: tickets.customerEmail,
        source: tickets.source,
        status: tickets.status,
        orderId: tickets.orderId,
        updatedAt: tickets.updatedAt,
        total: MATCH_TOTAL,
      })
      .from(tickets)
      .where(
        and(
          eq(tickets.workspaceId, workspaceId),
          everyTermMatches(TICKET_HAYSTACK, terms),
        ),
      )
      .orderBy(desc(tickets.updatedAt))
      .limit(limit),

    /**
     * ticket_messages has NO workspace_id. The innerJoin up to `tickets` plus
     * `tickets.workspace_id = $ws` is the ONLY thing keeping this query inside
     * one tenant: drop either half and this returns every customer message on
     * the platform that contains the search term. It is deliberately written
     * the same way as exportWorkspaceData in lib/data.ts, which is the other
     * place messages leave the system in bulk.
     */
    messages: db
      .select({
        id: ticketMessages.id,
        ticketId: ticketMessages.ticketId,
        direction: ticketMessages.direction,
        body: ticketMessages.body,
        sentAt: ticketMessages.sentAt,
        subject: tickets.subject,
        customerName: tickets.customerName,
        status: tickets.status,
        total: MATCH_TOTAL,
      })
      .from(ticketMessages)
      .innerJoin(tickets, eq(ticketMessages.ticketId, tickets.id))
      .where(
        and(
          eq(tickets.workspaceId, workspaceId),
          everyTermMatches(M_BODY, terms),
        ),
      )
      .orderBy(desc(ticketMessages.sentAt))
      .limit(limit),

    contacts: db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        firstSeen: contacts.firstSeen,
        // Correlated count, workspace-filtered on its own line rather than
        // inherited: the subquery selects FROM tickets afresh, so the outer
        // WHERE does not constrain it. `"contacts"."email"` is spelled out —
        // the interpolated form would render as a bare "email" and bind to
        // `tickets` the moment that table gains an email column.
        ticketCount: sql<number>`(
          SELECT count(*)::int FROM tickets t
          WHERE t.workspace_id = ${workspaceId}
            AND t.customer_email = ${C_EMAIL}
        )`,
        total: MATCH_TOTAL,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          everyTermMatches(CONTACT_HAYSTACK, terms),
        ),
      )
      .orderBy(asc(contacts.name))
      .limit(limit),

    labels: db
      .select({
        id: labels.id,
        name: labels.name,
        color: labels.color,
        // ticket_labels has no workspace_id either: the count joins up to
        // `tickets` and filters there, as listLabelsWithCounts does.
        ticketCount: sql<number>`(
          SELECT count(*)::int
          FROM ticket_labels tl
          JOIN tickets t ON t.id = tl.ticket_id
          WHERE tl.label_id = ${L_ID}
            AND t.workspace_id = ${workspaceId}
        )`,
        total: MATCH_TOTAL,
      })
      .from(labels)
      .where(
        and(
          eq(labels.workspaceId, workspaceId),
          everyTermMatches(L_NAME, terms),
        ),
      )
      .orderBy(asc(labels.name))
      .limit(limit),
  };
}

// ── Result shapes ────────────────────────────────────────────────

export type TicketHit = {
  id: number;
  ref: string;
  subject: Segment[];
  customerName: Segment[];
  customerEmail: Segment[];
  source: TicketSource;
  status: TicketStatus;
  orderId: string | null;
  updatedAt: Date;
  /** Human names of the fields that actually contain a term. */
  matchedIn: string[];
};

export type MessageHit = {
  id: number;
  ticketId: number;
  ref: string;
  /** Plain — the thread subject is context here, not the match. */
  subject: string;
  customerName: string;
  direction: MessageDirection;
  status: TicketStatus;
  sentAt: Date;
  snippet: Segment[];
};

export type ContactHit = {
  id: number;
  name: Segment[];
  email: Segment[];
  /** Plain address, for the link that finds this person's tickets. */
  rawEmail: string;
  firstSeen: Date;
  ticketCount: number;
};

export type LabelHit = {
  id: number;
  name: Segment[];
  color: LabelColor;
  ticketCount: number;
};

/** One group of results: what we are showing, and how many exist. */
export type SearchGroup<T> = {
  items: T[];
  /** Real COUNT of matches, not `items.length`. */
  total: number;
};

export type SearchResults = {
  /** The cleaned query, echoed back. */
  query: string;
  terms: string[];
  /** True when the query was too short to run — nothing was searched. */
  tooShort: boolean;
  tickets: SearchGroup<TicketHit>;
  messages: SearchGroup<MessageHit>;
  contacts: SearchGroup<ContactHit>;
  labels: SearchGroup<LabelHit>;
  /** Matches across all four groups. */
  total: number;
};

function emptyResults(query: string, tooShort: boolean): SearchResults {
  const none = { items: [], total: 0 };
  return {
    query,
    terms: [],
    tooShort: tooShort,
    tickets: none,
    messages: none,
    contacts: none,
    labels: none,
    total: 0,
  };
}

/** `count(*) OVER ()` is on every row; zero rows means zero matches. */
function totalOf(rows: { total: number }[]): number {
  return rows[0]?.total ?? 0;
}

/**
 * Run the search. Every group is scoped to `workspaceId`; see the header.
 *
 * The four statements run in parallel — they share nothing, and a search that
 * waited for message bodies before starting on labels would be four round
 * trips deep for no reason.
 */
export async function searchWorkspace(
  workspaceId: number,
  rawQuery: unknown,
  limit: number = SEARCH_GROUP_LIMIT,
): Promise<SearchResults> {
  const { text, terms } = parseSearchQuery(rawQuery);
  if (terms.length === 0) {
    return emptyResults(text, text.length > 0 && text.length < SEARCH_QUERY_MIN);
  }

  const q = searchQueries(workspaceId, terms, limit);
  const [ticketRows, messageRows, contactRows, labelRows] = await Promise.all([
    q.tickets,
    q.messages,
    q.contacts,
    q.labels,
  ]);

  const ticketHits: TicketHit[] = ticketRows.map((r) => ({
    id: r.id,
    ref: `TKT-${r.id}`,
    subject: highlightSegments(r.subject, terms),
    customerName: highlightSegments(r.customerName, terms),
    customerEmail: highlightSegments(r.customerEmail, terms),
    source: r.source,
    status: r.status,
    orderId: r.orderId,
    updatedAt: r.updatedAt,
    matchedIn: matchedFields(
      {
        subject: r.subject,
        name: r.customerName,
        email: r.customerEmail,
        "order id": r.orderId,
        reference: `TKT-${r.id}`,
      },
      terms,
    ),
  }));

  const messageHits: MessageHit[] = messageRows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    ref: `TKT-${r.ticketId}`,
    subject: r.subject,
    customerName: r.customerName,
    direction: r.direction,
    status: r.status,
    sentAt: r.sentAt,
    snippet: snippetSegments(r.body, terms),
  }));

  const contactHits: ContactHit[] = contactRows.map((r) => ({
    id: r.id,
    name: highlightSegments(r.name, terms),
    email: highlightSegments(r.email, terms),
    rawEmail: r.email,
    firstSeen: r.firstSeen,
    ticketCount: r.ticketCount,
  }));

  const labelHits: LabelHit[] = labelRows.map((r) => ({
    id: r.id,
    name: highlightSegments(r.name, terms),
    color: r.color,
    ticketCount: r.ticketCount,
  }));

  const groups = {
    tickets: { items: ticketHits, total: totalOf(ticketRows) },
    messages: { items: messageHits, total: totalOf(messageRows) },
    contacts: { items: contactHits, total: totalOf(contactRows) },
    labels: { items: labelHits, total: totalOf(labelRows) },
  };

  return {
    query: text,
    terms,
    tooShort: false,
    ...groups,
    total:
      groups.tickets.total +
      groups.messages.total +
      groups.contacts.total +
      groups.labels.total,
  };
}
