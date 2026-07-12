"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TicketDTO } from "@/lib/serialize";
import type { TicketSource } from "@/db/schema";
import { SOURCE_META, STATUS_META } from "@/lib/theme";

type Folder = "inbox" | "all" | "closed";
type SourceFilter = "all" | TicketSource;

const SOURCE_CHIPS: { key: SourceFilter; label: string; dot?: string }[] = [
  { key: "all", label: "All sources" },
  { key: "contact_form", label: "Contact form", dot: SOURCE_META.contact_form.dot },
  { key: "email", label: "Email", dot: SOURCE_META.email.dot },
  { key: "order", label: "Order", dot: SOURCE_META.order.dot },
];

const FOLDER_LABEL: Record<Folder, string> = {
  inbox: "Inbox",
  all: "All tickets",
  closed: "Closed",
};

export default function Inbox({
  tickets,
  folder,
}: {
  tickets: TicketDTO[];
  folder: Folder;
}) {
  const [source, setSource] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const router = useRouter();

  // Keep the inbox live: new tickets used to appear only on manual reload.
  // Server-component refetch every 45s, skipped while the tab is hidden.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 45_000);
    return () => clearInterval(id);
  }, [router]);

  const inFolder = useMemo(
    () =>
      tickets.filter((t) => {
        if (folder === "closed") return t.status === "closed";
        if (folder === "inbox") return t.status !== "closed";
        return true;
      }),
    [tickets, folder],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inFolder.filter((t) => {
      if (source !== "all" && t.source !== source) return false;
      if (
        q &&
        !(
          t.customerName.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          (t.orderId ?? "").toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [inFolder, source, search]);

  const openCount = tickets.filter((t) => t.status === "open").length;
  const activeCount = tickets.filter((t) => t.status !== "closed").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      <div style={{ padding: "22px 32px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
            gap: 16,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em", color: "var(--ink)" }}>
              {FOLDER_LABEL[folder]}
            </h1>
            <p style={{ fontSize: 13, color: "var(--muted-2)", marginTop: 3 }}>
              {openCount} open · {activeCount} active
            </p>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 38,
              padding: "0 13px",
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 10,
              width: 238,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                border: "1.6px solid #b8ac98",
                borderRadius: "50%",
                flex: "0 0 auto",
              }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              style={{
                border: "none",
                background: "transparent",
                fontSize: 13.5,
                color: "var(--ink)",
                width: "100%",
              }}
            />
          </div>
        </div>

        {/* source filter chips */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            paddingBottom: 16,
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          {SOURCE_CHIPS.map((c) => {
            const active = source === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setSource(c.key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "6px 13px",
                  borderRadius: 20,
                  cursor: "pointer",
                  border: "none",
                  background: active ? "#26221d" : "transparent",
                  color: active ? "#fff" : "#7a7264",
                }}
              >
                {c.dot && (
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 2,
                      background: c.dot,
                      opacity: active ? 0.9 : 1,
                    }}
                  />
                )}
                {c.label}
              </button>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-2)" }}>
            {visible.length} {visible.length === 1 ? "ticket" : "tickets"}
          </span>
        </div>
      </div>

      {/* rows */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 20px 24px" }}>
        {visible.length === 0 ? (
          <EmptyState
            hasAny={tickets.length > 0}
            onClear={() => {
              setSource("all");
              setSearch("");
            }}
          />
        ) : (
          visible.map((t) => <Row key={t.id} t={t} />)
        )}
      </div>
    </div>
  );
}

function Row({ t }: { t: TicketDTO }) {
  const src = SOURCE_META[t.source];
  const st = STATUS_META[t.status];
  const isOrder = t.source === "order";
  const isClosed = t.status === "closed";
  const unread = t.status === "open";
  const bg = isOrder ? "#fff" : isClosed ? "#faf8f4" : t.status === "in_progress" ? "#fbf9f5" : "#fff";
  const border = isOrder ? "#f2ddd0" : "#efeadf";

  return (
    <Link
      href={`/tickets/${t.id}`}
      className="pb-fade-up"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "15px 16px",
        borderRadius: 12,
        margin: "7px 0",
        border: `1px solid ${border}`,
        background: bg,
        opacity: isClosed ? 0.72 : 1,
      }}
    >
      {isOrder && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 11,
            bottom: 11,
            width: 3,
            borderRadius: 3,
            background: "var(--accent)",
          }}
        />
      )}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flex: "0 0 auto",
          background: unread ? "var(--accent)" : "transparent",
          border: unread ? "none" : "1.5px solid #d8cfbf",
        }}
      />
      <span
        style={{
          flex: "0 0 auto",
          fontSize: 11,
          fontWeight: 700,
          padding: "4px 10px",
          borderRadius: 6,
          letterSpacing: ".02em",
          textTransform: "uppercase",
          background: src.bg,
          color: src.fg,
        }}
      >
        {src.label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 14.5,
              fontWeight: unread ? 700 : 600,
              color: isClosed ? "#6b6558" : unread ? "var(--ink)" : "#4a453d",
            }}
          >
            {t.customerName}
          </span>
          {isOrder && t.orderId && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#b4491f",
                fontFamily: "var(--font-mono)",
                background: "#fbe9df",
                padding: "1px 6px",
                borderRadius: 5,
              }}
            >
              {t.orderId}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: isClosed ? "#a49a89" : unread ? "#7a7264" : "#948b7c",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {t.subject}
        </div>
      </div>
      <span
        style={{
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: st.fg,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
        {st.label}
      </span>
      <span style={{ flex: "0 0 46px", textAlign: "right", fontSize: 12, color: "var(--muted-2)" }}>
        {t.timeShort}
      </span>
    </Link>
  );
}

function EmptyState({ hasAny, onClear }: { hasAny: boolean; onClear: () => void }) {
  const title = hasAny ? "Nothing here" : "Welcome to your inbox";
  const body = hasAny
    ? "No tickets match your current filters. Try clearing them to see everything."
    : "You have no tickets yet. When a customer fills in your contact form, emails you, or an order comes in, it'll appear right here — ready to reply.";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "72px 24px",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 22,
          fontSize: 30,
          color: "var(--accent)",
        }}
      >
        ✉
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 700, color: "var(--ink)" }}>{title}</h2>
      <p
        style={{
          fontSize: 14,
          color: "var(--muted-2)",
          marginTop: 8,
          maxWidth: 340,
          lineHeight: 1.6,
        }}
      >
        {body}
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        {hasAny ? (
          <button
            onClick={onClear}
            style={{
              height: 38,
              padding: "0 16px",
              background: "#fff",
              border: "1px solid #e2d6c8",
              borderRadius: 9,
              fontSize: 13.5,
              fontWeight: 600,
              color: "#5f594f",
              cursor: "pointer",
            }}
          >
            Clear filters
          </button>
        ) : (
          <Link
            href="/install"
            style={{
              height: 38,
              padding: "0 16px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 9,
              fontSize: 13.5,
              fontWeight: 600,
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Connect your form
          </Link>
        )}
      </div>
    </div>
  );
}
