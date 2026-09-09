"use client";

import { useEffect, useMemo, useState } from "react";
import { labelChipProps } from "./label-style";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SOURCE_META } from "@/lib/theme";
import { Icon, SearchIcon } from "./icons";
import StarButton from "./StarButton";
import SwipeRow from "./SwipeRow";
import type { MailRow } from "./types";

type FormAction = (formData: FormData) => void;
/** Archive and Delete, revealed by swiping a card on a phone. Open folder only. */
export type SwipeActions = { archive: FormAction; trash: FormAction };

/**
 * The 336px list pane (full width below 768px).
 *
 * Folder + pagination are resolved on the server; the search box and the chips
 * refine the page that is already loaded, which is why neither shows a count of
 * its own — a chip count would contradict the nav's real totals.
 */

/*
 * Three filters, and that is the whole set.
 *
 * There used to be eight — awaiting, tagged, and one per source on top of
 * these — sitting in a horizontally scrolling row with a hidden scrollbar.
 * That row could not be reached with a mouse at all, so the extras were not
 * merely cluttered, they were unusable on a desktop. A "+N more" disclosure
 * fixed the reachability and left the real question standing: whether eight
 * ways to filter one page of results were worth having.
 *
 * They were not. The folders already answer "awaiting reply" and "labelled",
 * the source is visible as a chip on every card, and the search box above
 * covers the rest. These three are the ones that say something the list does
 * not already show.
 */
type Refine = "all" | "unread" | "starred";

/**
 * The folder strip shown under the search box on a phone. Open first, since
 * it is where the phone lands; then the ones that answer "what needs me",
 * then the places things are put away. Keys are MailFolder values from
 * app/(dashboard)/queries.ts — parseFolder accepts exactly these.
 */
const MOBILE_FOLDERS: [key: string, label: string][] = [
  ["inbox", "Open"],
  ["awaiting", "Awaiting"],
  ["unread", "Unread"],
  ["starred", "Starred"],
  ["snoozed", "Snoozed"],
  ["archived", "Archived"],
  ["closed", "Closed"],
  ["sent", "Sent"],
  ["labeled", "Labeled"],
  ["trash", "Trash"],
  ["all", "All mail"],
];

export default function MessageList({
  rows,
  folder,
  page,
  pageCount,
  total,
  selectedId,
  labelId,
  canPersonalise,
  hideOnMobile = false,
  swipeActions,
}: {
  rows: MailRow[];
  folder: string;
  page: number;
  pageCount: number;
  /** Real COUNT(*) for this folder — not the length of the loaded page. */
  total: number;
  selectedId?: number;
  /** Active per-label filter, carried through links so it survives paging. */
  labelId?: number;
  /** Viewer has an agent row here — Unread and Starred are meaningful. */
  canPersonalise: boolean;
  /** True on a thread route, where the phone shows the thread instead. */
  hideOnMobile?: boolean;
  /**
   * Supplied by the inbox page on the Open folder only. Without it the cards
   * do not swipe — the thread route's list pane and every other folder.
   */
  swipeActions?: SwipeActions;
}) {
  const [refine, setRefine] = useState<Refine>("all");
  const [search, setSearch] = useState("");
  const router = useRouter();

  /*
   * All three chips, for everybody.
   *
   * Unread and Starred are per-agent, and this used to show only "All" to a
   * viewer with no agent row — an operator looking at a client's inbox — on
   * the argument that the other two would read zero for them. True, and the
   * result was a filter row with one chip in it, which is not a filter row;
   * on a phone it read as something missing. Jordan asked for the full set on
   * 8 Sep 2026. For a viewer without an agent row the two per-agent chips
   * simply match nothing, and the empty state's "clear" puts it back.
   */
  const chips: { key: Refine; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "starred", label: "Starred" },
  ];

  // Keep the list live: new tickets used to appear only on manual reload.
  // Skipped while a thread is open — Thread runs its own 30s refresh for the
  // whole route, and two timers on one page is just double the server work.
  const live = selectedId === undefined;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 45_000);
    return () => clearInterval(id);
  }, [router, live]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (refine === "unread" && !r.unread) return false;
      if (refine === "starred" && !r.starred) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.preview.toLowerCase().includes(q) ||
        r.labels.some((l) => l.name.toLowerCase().includes(q)) ||
        (r.orderId ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, refine, search]);

  const refined = refine !== "all" || search.trim() !== "";
  const labelQuery = labelId === undefined ? "" : `&label=${labelId}`;
  // Sent is the same list of tickets read from the other end: the card leads
  // with who we wrote to and when we wrote, not who wrote to us and when they
  // last did anything.
  const sentView = folder === "sent";

  return (
    // `pb-scroll` because on a phone the LIST is the scroller (mail.css moves
    // the overflow up from .pbm-list-scroll so the search and chips scroll
    // away with the cards), and pb-scroll is what the drawer's scroll-lock
    // targets. Harmless on desktop, where the section does not scroll.
    <section
      className="pbm-list pb-scroll"
      data-hide-mobile={hideOnMobile || undefined}
      aria-label="Message list"
    >
      <div className="pbm-list-head">
        <div className="pbm-search">
          <span className="pbm-search-icon" aria-hidden>
            <SearchIcon size={16} />
          </span>
          <input
            className="pbm-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the tickets on this page"
            placeholder="Search this page…"
          />
        </div>

        {/*
          ── EVERY FOLDER, ON A PHONE ──
          Below 768px the navigation column is a drawer behind the burger, so
          the folders it lists are two taps away and — Jordan's report on
          8 Sep 2026 — the row under the search box showed "only 3 options".
          Those three were the refine chips (All / Unread / Starred), which
          filter the page already loaded; they are not folders. On a phone
          this row IS the folders instead: one horizontally scrolling strip of
          links, the current one marked, 44px tall for 2.5.5. mail.css shows
          this strip and hides the refine chips below 768px, and the reverse
          above it, where the column is always in view.
        */}
        <nav className="pbm-folder-strip" aria-label="Folders">
          {MOBILE_FOLDERS.map(([key, label]) => (
            <Link
              key={key}
              href={key === "inbox" ? "/inbox" : `/inbox?folder=${key}`}
              className="pbm-folder-chip"
              aria-current={folder === key ? "page" : undefined}
              data-on={folder === key || undefined}
              /* 2.4.9: "Open", "Sent" and "Closed" are not link purposes on
                 their own in a links list; "Open folder" is. */
              aria-label={`${label} folder`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="pbm-chips" role="group" aria-label="Refine this page">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="pbm-chip"
              data-on={refine === c.key}
              aria-pressed={refine === c.key}
              onClick={() => setRefine(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <p className="pbm-list-meta">
          {refined
            ? `${visible.length} of ${rows.length} on this page`
            : `${total} ${total === 1 ? "ticket" : "tickets"}`}
        </p>
      </div>

      <div className="pbm-list-scroll pb-scroll">
        {visible.length === 0 ? (
          <EmptyList
            search={search}
            refined={refined}
            hasAny={total > 0}
            sentView={sentView}
            onClear={() => {
              setRefine("all");
              setSearch("");
            }}
          />
        ) : (
          visible.map((r) => (
            <MailCard
              key={r.id}
              row={r}
              selected={r.id === selectedId}
              folder={folder}
              page={page}
              labelQuery={labelQuery}
              canPersonalise={canPersonalise}
              sentView={sentView}
              swipeActions={swipeActions}
            />
          ))
        )}

        {pageCount > 1 && (
          <nav className="pbm-pager" aria-label="Ticket pages">
            {page > 1 ? (
              <Link href={`/inbox?folder=${folder}${labelQuery}&page=${page - 1}`}>
                ← Newer
              </Link>
            ) : (
              <span className="pbm-pager-off">← Newer</span>
            )}
            <span className="pbm-pager-pos">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={`/inbox?folder=${folder}${labelQuery}&page=${page + 1}`}>
                Older →
              </Link>
            ) : (
              <span className="pbm-pager-off">Older →</span>
            )}
          </nav>
        )}
      </div>
    </section>
  );
}

function MailCard({
  row,
  selected,
  folder,
  page,
  labelQuery,
  canPersonalise,
  sentView = false,
  swipeActions,
}: {
  row: MailRow;
  selected: boolean;
  folder: string;
  page: number;
  labelQuery: string;
  canPersonalise: boolean;
  /** Reading this ticket as "something we sent" rather than "mail we got". */
  sentView?: boolean;
  swipeActions?: SwipeActions;
}) {
  const src = SOURCE_META[row.source];
  // `sentTime` is null only when the row has no human reply, which the sent
  // folder's WHERE already excludes — the fallback is for safety, not display.
  const showSent = sentView && row.sentTime !== null;
  const card = (
    // The star is a button and the card is a link, so they cannot nest. The
    // wrapper gives the star somewhere to sit without swallowing the row's
    // click target.
    <div className="pbm-card-wrap">
      <Link
        href={`/tickets/${row.id}?folder=${folder}${labelQuery}&page=${page}`}
        className="pbm-card"
        data-selected={selected || undefined}
        data-unread={row.unread || undefined}
        aria-current={selected ? "true" : undefined}
      >
        <div className="pbm-card-top">
          <span className="pbm-card-who">
            {row.unread && (
              <span className="pbm-dot" aria-hidden>
                <span className="pbm-sr">Unread</span>
              </span>
            )}
            {/* "To Ada Lovelace" in Sent: the row is a reply we wrote, and the
                name alone would read as a message from her. The address is the
                thing that was actually written to, so it is shown too — it can
                differ from the display name. */}
            <span className="pbm-card-name">
              {showSent ? `To ${row.name}` : row.name}
            </span>
            {showSent && <span className="pbm-card-preview">{row.email}</span>}
          </span>
          <span className="pbm-card-time">
            {showSent && <span className="pbm-sr">Last reply sent </span>}
            {showSent ? row.sentTime : row.time}
          </span>
        </div>
        <div className="pbm-card-subject">{row.subject}</div>
        <div className="pbm-card-preview">
          {showSent
            ? row.sentPreview || "This reply had no text."
            : row.preview || "No messages on this ticket yet."}
        </div>
        <div className="pbm-card-chips">
          {/* Real: which channel this ticket arrived on. */}
          <span className="pbm-tag" style={{ background: src.bg, color: src.fg }}>
            {src.label}
          </span>
          {row.labels.map((l) => (
            <span key={l.id} className="pbm-label pbm-label--sm" {...labelChipProps(l)}>
              <span className="pbm-label-name">{l.name}</span>
            </span>
          ))}
          {/* "Awaiting" is a property of the ticket, not of you: nobody has
              answered this customer. It stays after you read the thread, which
              is exactly what separates it from the unread dot above. */}
          {row.awaitingReply && (
            <span className="pbm-tag pbm-tag--awaiting">Awaiting</span>
          )}
          {row.orderId && <span className="pbm-tag pbm-tag--order">{row.orderId}</span>}
        </div>
      </Link>
      <StarButton
        ticketId={row.id}
        starred={row.starred}
        canStar={canPersonalise}
        size={15}
        className="pbm-card-star"
      />
    </div>
  );
  if (!swipeActions) return card;
  return (
    <SwipeRow ticketId={row.id} actions={swipeActions}>
      {card}
    </SwipeRow>
  );
}

function EmptyList({
  refined,
  hasAny,
  sentView = false,
  onClear,
  search,
}: {
  refined: boolean;
  hasAny: boolean;
  sentView?: boolean;
  onClear: () => void;
  /** What they typed in the box above, so "search everything" can carry it. */
  search: string;
}) {
  // An empty Sent folder has one cause and one cure, and neither is "connect
  // your form" — the tickets may well be sitting in the inbox already. It also
  // has to say what does not count, or the auto-acknowledgement customers have
  // definitely received makes this screen look broken.
  // `hasAny` guards the odd case of a real total with an empty page (an
  // out-of-range ?page=), where "nothing sent yet" would be a lie.
  const emptySent = sentView && !refined && !hasAny;
  return (
    <div className="pbm-empty">
      <span className="pbm-empty-mark" aria-hidden>
        <Icon name={emptySent ? "send" : "mail"} size={26} />
      </span>
      <h2 className="pbm-empty-title">
        {refined
          ? "Nothing matches"
          : emptySent
            ? "Nothing sent yet"
            : hasAny
              ? "Nothing in this folder"
              : "No tickets yet"}
      </h2>
      <p className="pbm-empty-body">
        {refined
          ? "No tickets on this page match your search or chips."
          : emptySent
            ? "Open a ticket and reply to it, and the thread lands here. Automatic acknowledgements don’t count — this folder is what your team wrote."
            : hasAny
              ? "Other folders still have tickets in them."
              : "When someone fills in your contact form or emails you, the thread appears here."}
      </p>
      {refined ? (
        <div className="pbm-empty-actions">
          <button className="pbm-btn" onClick={onClear}>
            Clear
          </button>
          {/*
            THE WAY INTO WORKSPACE-WIDE SEARCH.

            The box above filters THIS PAGE only, and this screen is the exact
            moment somebody learns that — they typed a customer's name, found
            nothing, and the honest next question is "so where is it?".

            /search reads every ticket, message body, contact and label in the
            workspace. It used to have a sidebar row, which was removed on 23
            August because a twelfth row did not make search easier to find.
            That left the route with no entry point at all, which was worse:
            the feature existed and could only be reached by typing the URL,
            which is precisely the complaint the sidebar row had been added to
            fix. This is where it belongs — offered at the point the on-page
            filter runs out, rather than competing with the folders.
          */}
          {search.trim() && (
            <Link
              className="pbm-btn pbm-btn--quiet"
              href={`/search?q=${encodeURIComponent(search.trim())}`}
            >
              Search everything
            </Link>
          )}
        </div>
      ) : (
        !hasAny &&
        !emptySent && (
          <Link className="pbm-btn" href="/settings/install">
            Connect your form
          </Link>
        )
      )}
    </div>
  );
}
