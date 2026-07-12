"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TicketDTO, MessageDTO } from "@/lib/serialize";
import type { TicketStatus } from "@/db/schema";
import { SOURCE_META, STATUS_META, STATUS_ORDER } from "@/lib/theme";
import { initials } from "@/lib/tickets";
import { formatDateTime } from "@/lib/serialize";

export default function TicketThread({
  ticket,
  messages,
  fromAddress,
  ownerLabel,
}: {
  ticket: TicketDTO;
  messages: MessageDTO[];
  fromAddress: string;
  ownerLabel: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer replies should appear without a manual reload.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  const src = SOURCE_META[ticket.source];
  const st = STATUS_META[status];
  const isOrder = ticket.source === "order";
  const ownerInitials = initials(ownerLabel);

  async function changeStatus(next: TicketStatus) {
    setStatusMenuOpen(false);
    if (next === status) return;
    const prev = status;
    setStatus(next);
    const res = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      setStatus(prev);
      setError("Couldn't update status.");
      return;
    }
    router.refresh();
  }

  async function sendReply() {
    const message = replyText.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticket.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    setSending(false);
    if (!res.ok) {
      setError("Couldn't send your reply. Please try again.");
      return;
    }
    const data = (await res.json()) as { emailSent?: boolean };
    setReplyText("");
    if (status !== "closed") setStatus("in_progress");
    if (data.emailSent === false) {
      setError("Saved to the thread, but email delivery isn't configured yet.");
    }
    router.refresh();
  }

  const canSend = replyText.trim().length > 0 && !sending;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      {/* header */}
      <div style={{ padding: "18px 32px", borderBottom: "1px solid var(--border-soft)", background: "var(--app-bg)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--muted-2)",
                marginBottom: 9,
              }}
            >
              <span style={{ fontSize: 14 }}>←</span> Back to inbox
            </Link>
            <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--ink)", marginBottom: 8, lineHeight: 1.25 }}>
              {ticket.subject}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: 6,
                  textTransform: "uppercase",
                  letterSpacing: ".02em",
                  background: src.bg,
                  color: src.fg,
                }}
              >
                {src.label}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#3a3530" }}>{ticket.customerName}</span>
              <span style={{ fontSize: 13, color: "var(--muted-2)" }}>{ticket.customerEmail}</span>
            </div>
          </div>

          {/* status dropdown */}
          <div style={{ position: "relative", flex: "0 0 auto" }}>
            <button
              onClick={() => setStatusMenuOpen((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                height: 38,
                padding: "0 14px",
                background: "#fff",
                border: "1px solid #e2d6c8",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: st.dot }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: st.fg }}>{st.label}</span>
              <span style={{ color: "var(--muted-3)", fontSize: 10, marginLeft: 2 }}>▾</span>
            </button>
            {statusMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: 44,
                  right: 0,
                  width: 180,
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 11,
                  boxShadow: "0 16px 34px -14px rgba(60,50,35,.32)",
                  padding: 6,
                  zIndex: 40,
                }}
              >
                {STATUS_ORDER.map((k) => {
                  const meta = STATUS_META[k];
                  return (
                    <button
                      key={k}
                      onClick={() => changeStatus(k)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "9px 10px",
                        borderRadius: 8,
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: "#3a3530",
                        cursor: "pointer",
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot }} />
                      {meta.label}
                      {status === k && (
                        <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 13 }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* thread */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 8px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          {isOrder && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "16px 20px",
                background: "#fdf3ee",
                border: "1px solid #f2ddd0",
                borderRadius: 14,
                marginBottom: 22,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "#fbe4d8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                  fontSize: 18,
                }}
              >
                ▦
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#b4491f", letterSpacing: ".04em" }}>
                  ORDER TICKET · HIGH PRIORITY
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
                    {ticket.orderId}
                  </span>
                  <span style={{ fontSize: 13, color: "#7a6d5f" }}>Linked order reference</span>
                </div>
              </div>
            </div>
          )}

          {messages.map((m) => {
            const out = m.direction === "outbound";
            return (
              <div
                key={m.id}
                style={{
                  border: `1px solid ${out ? "var(--accent-line)" : "#eee7db"}`,
                  borderRadius: 14,
                  padding: "17px 19px",
                  background: out ? "var(--accent-soft)" : "#fff",
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      flex: "0 0 auto",
                      background: out ? "var(--accent)" : "#e7e0d3",
                      color: out ? "#fff" : "#6b5f49",
                    }}
                  >
                    {out ? ownerInitials : initials(ticket.customerName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                        {out ? "You" : ticket.customerName}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: ".03em",
                          padding: "2px 7px",
                          borderRadius: 5,
                          background: out ? "#fff" : "#f0ece3",
                          color: out ? "var(--accent-strong)" : "#8a8175",
                        }}
                      >
                        {out ? "You · owner" : "Customer"}
                      </span>
                    </div>
                    {/* Formatted client-side for the viewer's timezone; the
                        SSR pass renders UTC, so suppress the mismatch. */}
                    <div
                      suppressHydrationWarning
                      style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 1 }}
                    >
                      {formatDateTime(m.sentAtIso)}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 14.5,
                    color: "#3a3530",
                    lineHeight: 1.65,
                    marginTop: 13,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.body}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* reply composer */}
      <div style={{ borderTop: "1px solid var(--border-soft)", background: "#f6f2eb", padding: "16px 32px 20px" }}>
        <div
          style={{
            maxWidth: 780,
            margin: "0 auto",
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "0 6px 20px -12px rgba(60,50,35,.2)",
            overflow: "hidden",
          }}
        >
          <div style={rowLine}>
            <span style={{ color: "var(--muted-2)", width: 44 }}>To</span>
            <span style={{ fontWeight: 500, color: "#3a3530" }}>{ticket.customerName}</span>
            <span style={{ color: "#b0a795" }}>&lt;{ticket.customerEmail}&gt;</span>
          </div>
          <div style={rowLine}>
            <span style={{ color: "var(--muted-2)", width: 44 }}>Subject</span>
            <span style={{ fontWeight: 500, color: "#3a3530" }}>
              {ticket.subject.startsWith("Re:") ? ticket.subject : `Re: ${ticket.subject}`}
            </span>
          </div>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply… it sends as a real email and threads back here."
            style={{
              width: "100%",
              minHeight: 96,
              resize: "none",
              border: "none",
              padding: "14px 16px",
              fontSize: 14.5,
              lineHeight: 1.6,
              color: "var(--ink)",
              background: "transparent",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "11px 16px",
              background: "var(--app-bg)",
              borderTop: "1px solid #f0ebe2",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--muted-2)", minWidth: 0 }}>
              {error ? (
                <span style={{ color: "#9a5a4a" }}>{error}</span>
              ) : (
                <>
                  Sending from{" "}
                  <b style={{ color: "#6b6255", fontWeight: 600 }}>{fromAddress}</b>
                </>
              )}
            </span>
            <button
              onClick={sendReply}
              disabled={!canSend}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 38,
                padding: "0 18px",
                border: "none",
                borderRadius: 9,
                fontSize: 13.5,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                cursor: canSend ? "pointer" : "not-allowed",
                opacity: canSend ? 1 : 0.5,
                flex: "0 0 auto",
              }}
            >
              <span style={{ fontSize: 14, marginRight: 6 }}>↑</span>
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const rowLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 16px",
  borderBottom: "1px solid #f0ebe2",
  fontSize: 13,
};
