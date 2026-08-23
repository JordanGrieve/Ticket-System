"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TicketSource } from "@/db/schema";
import { SOURCE_META } from "@/lib/theme";
import { Icon, SearchIcon } from "./icons";
import StarButton from "./StarButton";
import type { MailRow } from "./types";

/**
 * The 336px list pane (full width below 768px).
 *
 * Folder + pagination are resolved on the server; the search box and the chips
 * refine the page that is already loaded, which is why neither shows a count of
 * its own — a chip count would contradict the nav's real totals.
 */

type Refine = "all" | "unread" | "awaiting" | "starred" | "tagged" | TicketSource;

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
}) {
  const [refine, setRefine] = useState<Refine>("all");
  const [chipsOpen, setChipsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();

  // "Unread" and "Starred" only exist for a viewer with an agent row; the rest
  // are properties of the ticket and always apply.
  /*
   * How many chips are shown before "More".
   *
   * The row used to hold up to eight and rely on `overflow-x: auto` with a
   * hidden scrollbar. That works on a touchscreen and on a trackpad, and NOT
   * with a mouse — there is no visible scrollbar to drag and no wheel axis for
   * it, so on a desktop the chips past the edge were simply unreachable. They
   * were not hard to find; they could not be got to at all.
   */
  const CHIPS_SHOWN = 3;

  const chips: { key: Refine; label: string }[] = [
    { key: "all", label: "All" },
    ...(canPersonalise
      ? ([
          { key: "unread", label: "Unread" },
          { key: "starred", label: "Starred" },
        ] as { key: Refine; label: string }[])
      : []),
    { key: "awaiting", label: "Awaiting" },
    { key: "tagged", label: "Tagged" },
    { key: "contact_form", label: "Contact form" },
    { key: "email", label: "Email" },
    { key: "order", label: "Order" },
  ];

  /*
   * The first three, PLUS the active one if it is not among them. Without that
   * second half, choosing "Order" and then collapsing would leave a filtered
   * list with nothing on screen saying it was filtered.
   */
  const head = chips.slice(0, CHIPS_SHOWN);
  const shownChips = head.some((c) => c.key === refine)
    ? head
    : [...head, ...chips.filter((c) => c.key === refine)];
  const hiddenCount = chips.length - shownChips.length;

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
      if (refine === "awaiting" && !r.awaitingReply) return false;
      if (refine === "tagged" && r.labels.length === 0) return false;
      const isSource =
        refine === "contact_form" || refine === "email" || refine === "order";
      if (isSource && r.source !== refine) return false;
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
    <section
      className="pbm-list"
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
          Three, then "More".

          The active chip is ALWAYS shown, even when it lives past the cut:
          collapsing the row while "Order" is the current filter would hide the
          only thing explaining why the list is short, and the list would look
          like it had lost mail.
        */}
        <div className="pbm-chips" role="group" aria-label="Refine this page">
          {(chipsOpen ? chips : shownChips).map((c) => (
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
          {hiddenCount > 0 && (
            <button
              type="button"
              className="pbm-chip pbm-chip--more"
              onClick={() => setChipsOpen((v) => !v)}
              aria-expanded={chipsOpen}
            >
              {chipsOpen ? "Less" : `+${hiddenCount} more`}
            </button>
          )}
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
}: {
  row: MailRow;
  selected: boolean;
  folder: string;
  page: number;
  labelQuery: string;
  canPersonalise: boolean;
  /** Reading this ticket as "something we sent" rather than "mail we got". */
  sentView?: boolean;
}) {
  const src = SOURCE_META[row.source];
  // `sentTime` is null only when the row has no human reply, which the sent
  // folder's WHERE already excludes — the fallback is for safety, not display.
  const showSent = sentView && row.sentTime !== null;
  return (
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
            <span key={l.id} className="pbm-label pbm-label--sm" data-color={l.color}>
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
}

function EmptyList({
  refined,
  hasAny,
  sentView = false,
  onClear,
}: {
  refined: boolean;
  hasAny: boolean;
  sentView?: boolean;
  onClear: () => void;
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
        <button className="pbm-btn" onClick={onClear}>
          Clear
        </button>
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
