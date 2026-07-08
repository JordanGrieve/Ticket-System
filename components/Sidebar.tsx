"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { initials } from "@/lib/tickets";

type Counts = { inbox: number; all: number; closed: number };

export default function Sidebar({
  workspaceName,
  userLabel,
  counts,
  isAdmin = false,
}: {
  workspaceName: string;
  userLabel: string;
  counts: Counts;
  isAdmin?: boolean;
}) {
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onList = pathname === "/";
  const activeFolder = onList ? searchParams.get("folder") ?? "inbox" : "";

  const folders: { key: string; label: string; count: number }[] = [
    { key: "inbox", label: "Inbox", count: counts.inbox },
    { key: "all", label: "All tickets", count: counts.all },
    { key: "closed", label: "Closed", count: counts.closed },
  ];

  return (
    <aside
      style={{
        width: 222,
        flex: "0 0 222px",
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 14px",
      }}
    >
      {isAdmin && (
        <Link
          href="/admin"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 10px",
            marginBottom: 8,
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--accent-strong)",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-line)",
          }}
        >
          <span style={{ fontSize: 13 }}>←</span> All clients
        </Link>
      )}

      {/* workspace dropdown */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setWsMenuOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 10px",
            borderRadius: 10,
            cursor: "pointer",
            border: "1px solid transparent",
            background: "transparent",
            width: "100%",
            textAlign: "left",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 16,
              flex: "0 0 auto",
            }}
          >
            p
          </div>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 700,
                color: "var(--ink)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {workspaceName}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)" }}>
              {isAdmin ? "viewing as admin" : "postbox workspace"}
            </div>
          </div>
          <span style={{ color: "var(--muted-2)", fontSize: 11 }}>▾</span>
        </button>

        {wsMenuOpen && (
          <div
            style={{
              position: "absolute",
              top: 52,
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 11,
              boxShadow: "0 16px 34px -14px rgba(60,50,35,.32)",
              padding: 6,
              zIndex: 40,
            }}
          >
            <Link
              href="/install"
              onClick={() => setWsMenuOpen(false)}
              style={menuItem}
            >
              <span style={{ fontSize: 14 }}>⚙</span> Settings &amp; install
            </Link>
            <div style={{ height: 1, background: "#eee7db", margin: "5px 8px" }} />
            <SignOutButton>
              <button style={{ ...menuItem, color: "#9a5a4a", width: "100%" }}>
                <span style={{ fontSize: 14 }}>⏻</span> Sign out
              </button>
            </SignOutButton>
          </div>
        )}
      </div>

      <Link href="/install" style={newBtn}>
        <span style={{ fontSize: 16, fontWeight: 400, marginTop: -1 }}>+</span> New
        ticket
      </Link>

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted-3)",
          letterSpacing: ".07em",
          padding: "2px 12px 8px",
        }}
      >
        VIEWS
      </div>

      {folders.map((f) => {
        const active = activeFolder === f.key;
        return (
          <Link
            key={f.key}
            href={f.key === "inbox" ? "/" : `/?folder=${f.key}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderRadius: 10,
              marginBottom: 2,
              color: active ? "var(--ink)" : "#6b6255",
              background: active ? "#fff" : "transparent",
              border: `1px solid ${active ? "var(--border)" : "transparent"}`,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: active ? 700 : 500 }}>
              {f.label}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "1px 8px",
                borderRadius: 20,
                color: active ? "var(--accent-strong)" : "var(--muted-2)",
                background: active ? "var(--accent-soft)" : "var(--border)",
              }}
            >
              {f.count}
            </span>
          </Link>
        );
      })}

      <div style={{ marginTop: "auto" }}>
        <Link href="/install" style={{ ...menuItem, color: "#6b6255" }}>
          <span style={{ fontSize: 15 }}>⚙</span> Settings
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 12,
            marginTop: 6,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "#d9cdb8",
              color: "#6b5f49",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              flex: "0 0 auto",
            }}
          >
            {initials(userLabel)}
          </div>
          <div style={{ lineHeight: 1.15, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {userLabel}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-2)" }}>
              {isAdmin ? "Admin" : "Owner"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

const menuItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "9px 10px",
  borderRadius: 8,
  fontSize: 13.5,
  fontWeight: 500,
  color: "#3a3530",
  cursor: "pointer",
  background: "transparent",
  border: "none",
};

const newBtn: React.CSSProperties = {
  margin: "18px 4px 16px",
  height: 40,
  borderRadius: 10,
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
};
