"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TicketSource } from "@/db/schema";
import { SOURCE_META } from "@/lib/theme";
import { Icon, SearchIcon } from "./icons";
import type { MailRow } from "./types";

/**
 * The 336px list pane (full width below 768px).
 *
 * Folder + pagination are resolved on the server; the search box and the chips
 * refine the page that is already loaded, which is why neither shows a count of
 * its own — a chip count would contradict the nav's real totals.
 */

type Refine = "all" | "awaiting" | TicketSource;

const REFINE_CHIPS: { key: Refine; label: string }[] = [
  { key: "all", label: "All" },
  { key: "awaiting", label: "Awaiting" },
  { key: "contact_form", label: "Contact form" },
  { key: "email", label: "Email" },
  { key: "order", label: "Order" },
];

/** Chips the design shows that nothing in the schema can answer. */
const DEAD_CHIPS = ["Starred", "Labeled"];

export default function MessageList({
  rows,
  folder,
  page,
  pageCount,
  total,
  selectedId,
  hideOnMobile = false,
}: {
  rows: MailRow[];
  folder: string;
  page: number;
  pageCount: number;
  /** Real COUNT(*) for this folder — not the length of the loaded page. */
  total: number;
  selectedId?: number;
  /** True on a thread route, where the phone shows the thread instead. */
  hideOnMobile?: boolean;
}) {
  const [refine, setRefine] = useState<Refine>("all");
  const [search, setSearch] = useState("");
  const router = useRouter();

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
      if (refine === "awaiting" && !r.awaitingReply) return false;
      if (refine !== "all" && refine !== "awaiting" && r.source !== refine) {
        return false;
      }
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.preview.toLowerCase().includes(q) ||
        (r.orderId ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, refine, search]);

  const refined = refine !== "all" || search.trim() !== "";

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

        <div className="pbm-chips" role="group" aria-label="Refine this page">
          {REFINE_CHIPS.map((c) => (
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
          {DEAD_CHIPS.map((label) => (
            <button
              key={label}
              type="button"
              className="pbm-chip pbm-chip--dead"
              disabled
              title={`${label} isn't available yet — nothing stores it.`}
            >
              {label}
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
            refined={refined}
            hasAny={total > 0}
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
            />
          ))
        )}

        {pageCount > 1 && (
          <nav className="pbm-pager" aria-label="Ticket pages">
            {page > 1 ? (
              <Link href={`/inbox?folder=${folder}&page=${page - 1}`}>← Newer</Link>
            ) : (
              <span className="pbm-pager-off">← Newer</span>
            )}
            <span className="pbm-pager-pos">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={`/inbox?folder=${folder}&page=${page + 1}`}>Older →</Link>
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
}: {
  row: MailRow;
  selected: boolean;
  folder: string;
  page: number;
}) {
  const src = SOURCE_META[row.source];
  return (
    <Link
      href={`/tickets/${row.id}?folder=${folder}&page=${page}`}
      className="pbm-card pb-fade-up"
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
    >
      <div className="pbm-card-top">
        <span className="pbm-card-who">
          {row.awaitingReply && (
            <span
              className="pbm-dot"
              title="The last message on this ticket came from the customer"
            >
              <span className="pbm-sr">Awaiting your reply</span>
            </span>
          )}
          <span className="pbm-card-name">{row.name}</span>
        </span>
        <span className="pbm-card-time">{row.time}</span>
      </div>
      <div className="pbm-card-subject">{row.subject}</div>
      <div className="pbm-card-preview">
        {row.preview || "No messages on this ticket yet."}
      </div>
      <div className="pbm-card-chips">
        {/* Real: which channel this ticket arrived on. The design's coloured
            "tag" chip has no labels table behind it, so the source badge —
            which uses the same tag tokens — takes that slot. */}
        <span
          className="pbm-tag"
          style={{ background: src.bg, color: src.fg }}
        >
          {src.label}
        </span>
        {row.orderId && <span className="pbm-tag pbm-tag--order">{row.orderId}</span>}
        {/* No attachment chip: attachments are not stored, and a chip that is
            always absent is more honest than one that is always fake. */}
      </div>
    </Link>
  );
}

function EmptyList({
  refined,
  hasAny,
  onClear,
}: {
  refined: boolean;
  hasAny: boolean;
  onClear: () => void;
}) {
  return (
    <div className="pbm-empty">
      <span className="pbm-empty-mark" aria-hidden>
        <Icon name="mail" size={26} />
      </span>
      <h2 className="pbm-empty-title">
        {refined ? "Nothing matches" : hasAny ? "Nothing in this folder" : "No tickets yet"}
      </h2>
      <p className="pbm-empty-body">
        {refined
          ? "No tickets on this page match your search or chips."
          : hasAny
            ? "Other folders still have tickets in them."
            : "When someone fills in your contact form or emails you, the thread appears here."}
      </p>
      {refined ? (
        <button className="pbm-btn" onClick={onClear}>
          Clear
        </button>
      ) : (
        !hasAny && (
          <Link className="pbm-btn" href="/install">
            Connect your form
          </Link>
        )
      )}
    </div>
  );
}
