import Link from "next/link";
import { redirect } from "next/navigation";
import MobileTabs from "@/components/mail/MobileTabs";
import SearchField from "@/components/mail/SearchField";
import { Icon } from "@/components/mail/icons";
import { resolveViewer } from "@/lib/viewer";
import { SOURCE_META } from "@/lib/theme";
import { initials, relativeTime } from "@/lib/ticket-format";
import {
  SEARCH_QUERY_MIN,
  searchWorkspace,
  type ContactHit,
  type LabelHit,
  type MessageHit,
  type Segment,
  type TicketHit,
} from "@/lib/search";
import { viewerAgentId } from "../queries";

/**
 * /search?q=… — results across tickets, message bodies, contacts and labels.
 *
 * One full-width pane rather than the two-pane mail layout: a result set spans
 * four kinds of thing, and squeezing it into the 336px list column would mean
 * truncating exactly the snippets that make the result useful.
 *
 * Everything here is scoped to `viewer.workspace` — see the tenancy note at the
 * top of lib/search.ts. The workspace id is taken from the resolved viewer and
 * never from the URL, so there is no parameter to tamper with.
 *
 * Nothing on this page is invented. Every count is a real COUNT(*) over the
 * match window (`count(*) OVER ()`), and a group with no data renders as an
 * absent group rather than a zero that might be a bug.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQuery } = await searchParams;

  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspaceId = viewer.workspace.id;

  const [results, agentId] = await Promise.all([
    searchWorkspace(workspaceId, rawQuery ?? ""),
    viewerAgentId(workspaceId),
  ]);
  const now = new Date();

  const asked = results.terms.length > 0;

  return (
    <>
      <section className="pbm-results" aria-label="Search results">
        <div className="pbm-results-head">
          <SearchField initialQuery={results.query} autoFocus />
          <p className="pbm-results-meta" role="status">
            <ResultsSummary
              asked={asked}
              tooShort={results.tooShort}
              total={results.total}
              query={results.query}
            />
          </p>
        </div>

        <div className="pbm-results-scroll pb-scroll">
          {!asked ? (
            <Placeholder
              title={results.tooShort ? "Keep typing" : "Search this workspace"}
              body={
                results.tooShort
                  ? `Searches need at least ${SEARCH_QUERY_MIN} characters — one letter matches almost everything.`
                  : "Subjects, senders, the text inside messages, your contacts and your labels. Try an address, a word from a reply, or a ticket reference like TKT-42."
              }
            />
          ) : results.total === 0 ? (
            <Placeholder
              title="No matches"
              body={`Nothing in ${viewer.workspace.name} contains ${
                results.terms.length > 1 ? "all of those words" : "that"
              }. Every word has to appear somewhere in the same ticket, message, contact or label.`}
            />
          ) : (
            <>
              <Group
                title="Tickets"
                shown={results.tickets.items.length}
                total={results.tickets.total}
              >
                {results.tickets.items.map((t) => (
                  <TicketResult key={t.id} hit={t} now={now} />
                ))}
              </Group>

              <Group
                title="Messages"
                shown={results.messages.items.length}
                total={results.messages.total}
              >
                {results.messages.items.map((m) => (
                  <MessageResult key={m.id} hit={m} now={now} />
                ))}
              </Group>

              <Group
                title="People"
                shown={results.contacts.items.length}
                total={results.contacts.total}
                aside={
                  <Link className="pbm-results-aside" href="/settings/contacts">
                    All contacts
                  </Link>
                }
              >
                {results.contacts.items.map((c) => (
                  <ContactResult key={c.id} hit={c} now={now} />
                ))}
              </Group>

              <Group
                title="Labels"
                shown={results.labels.items.length}
                total={results.labels.total}
              >
                {results.labels.items.map((l) => (
                  <LabelResult key={l.id} hit={l} />
                ))}
              </Group>
            </>
          )}
        </div>
      </section>

      <MobileTabs canPersonalise={agentId !== null} />
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────

/** Matched runs get a <mark>; everything else is plain text. */
function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark className="pbm-hit" key={i}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function ResultsSummary({
  asked,
  tooShort,
  total,
  query,
}: {
  asked: boolean;
  tooShort: boolean;
  total: number;
  query: string;
}) {
  if (tooShort) return <>Too short to search.</>;
  if (!asked) return <>Nothing searched yet.</>;
  return (
    <>
      {total} {total === 1 ? "match" : "matches"} for “{query}”
    </>
  );
}

/**
 * A group renders nothing at all when it is empty. An empty group with a "0"
 * beside it reads as a broken query rather than as "there are no labels called
 * that", and the summary line already carries the overall total.
 */
function Group({
  title,
  shown,
  total,
  aside,
  children,
}: {
  title: string;
  shown: number;
  total: number;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (total === 0) return null;
  return (
    <section className="pbm-group" aria-label={title}>
      <header className="pbm-group-head">
        <h2 className="pbm-group-title">{title}</h2>
        <span className="pbm-group-count">{total}</span>
        {/* Honest about the cut: the group is capped, the count is not. */}
        {shown < total && (
          <span className="pbm-group-more">showing the newest {shown}</span>
        )}
        {aside}
      </header>
      <div className="pbm-group-body">{children}</div>
    </section>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="pbm-empty">
      <span className="pbm-empty-mark" aria-hidden>
        <Icon name="mail" size={26} />
      </span>
      <h2 className="pbm-empty-title">{title}</h2>
      <p className="pbm-empty-body">{body}</p>
    </div>
  );
}

function TicketResult({ hit, now }: { hit: TicketHit; now: Date }) {
  const src = SOURCE_META[hit.source];
  return (
    <Link className="pbm-result" href={`/tickets/${hit.id}?folder=all`}>
      <div className="pbm-result-top">
        <span className="pbm-result-title">
          <Marked segments={hit.subject} />
        </span>
        <span className="pbm-result-time">{relativeTime(hit.updatedAt, now)}</span>
      </div>
      <div className="pbm-result-line">
        <Marked segments={hit.customerName} /> ·{" "}
        <Marked segments={hit.customerEmail} />
      </div>
      <div className="pbm-result-chips">
        <span className="pbm-tag" style={{ background: src.bg, color: src.fg }}>
          {src.label}
        </span>
        <span className="pbm-tag pbm-tag--ref">{hit.ref}</span>
        {hit.status === "closed" && (
          <span className="pbm-tag pbm-tag--ref">Closed</span>
        )}
        {hit.orderId && <span className="pbm-tag pbm-tag--order">{hit.orderId}</span>}
        {/* Which field actually matched — otherwise a hit on the sender's
            address looks like a hit on a subject that plainly doesn't contain
            the word. */}
        {hit.matchedIn.length > 0 && (
          <span className="pbm-result-where">matched {hit.matchedIn.join(", ")}</span>
        )}
      </div>
    </Link>
  );
}

function MessageResult({ hit, now }: { hit: MessageHit; now: Date }) {
  return (
    <Link className="pbm-result" href={`/tickets/${hit.ticketId}?folder=all`}>
      <div className="pbm-result-top">
        <span className="pbm-result-title">{hit.subject}</span>
        <span className="pbm-result-time">{relativeTime(hit.sentAt, now)}</span>
      </div>
      <p className="pbm-result-snippet">
        <Marked segments={hit.snippet} />
      </p>
      <div className="pbm-result-chips">
        <span className="pbm-tag pbm-tag--ref">{hit.ref}</span>
        {/* Who wrote the matching line. "Reply" rather than an agent name:
            ticket_messages records a direction, not an author. */}
        <span className="pbm-tag pbm-tag--ref">
          {hit.direction === "inbound" ? hit.customerName : "Reply from your team"}
        </span>
      </div>
    </Link>
  );
}

function ContactResult({ hit, now }: { hit: ContactHit; now: Date }) {
  // There is no per-contact page in this product, so the useful destination is
  // this person's mail — which is this same search, narrowed to their address.
  return (
    <Link
      className="pbm-result pbm-result--person"
      href={`/search?q=${encodeURIComponent(hit.rawEmail)}`}
    >
      <span className="pbm-result-avatar" aria-hidden>
        {initials(hit.name.map((s) => s.text).join(""))}
      </span>
      <span className="pbm-result-person">
        <span className="pbm-result-title">
          <Marked segments={hit.name} />
        </span>
        <span className="pbm-result-line">
          <Marked segments={hit.email} />
        </span>
      </span>
      <span className="pbm-result-meta">
        <span className="pbm-result-count">
          {hit.ticketCount} {hit.ticketCount === 1 ? "ticket" : "tickets"}
        </span>
        <span className="pbm-result-time">
          first seen {relativeTime(hit.firstSeen, now)} ago
        </span>
      </span>
    </Link>
  );
}

function LabelResult({ hit }: { hit: LabelHit }) {
  return (
    <Link
      className="pbm-result pbm-result--label"
      href={`/inbox?folder=labeled&label=${hit.id}`}
    >
      <span className="pbm-label" data-color={hit.color}>
        <span className="pbm-label-name">
          <Marked segments={hit.name} />
        </span>
      </span>
      <span className="pbm-result-count">
        {hit.ticketCount} {hit.ticketCount === 1 ? "ticket" : "tickets"}
      </span>
    </Link>
  );
}
