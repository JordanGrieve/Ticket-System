import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { listContactsWithCounts } from "@/lib/data";
import { initials, relativeTime } from "@/lib/tickets";

/**
 * Every person who has ever contacted this workspace — collected since v1,
 * now finally visible. CRM-lite: name, email, first seen, ticket count.
 */
export default async function ContactsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");

  const rows = await listContactsWithCounts(viewer.workspace.id);
  const now = new Date();

  return (
    // The pane wrapper lives in the settings layout, shared with the other tabs.
    <>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 32px 64px" }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: "var(--ink)",
          }}
        >
          Contacts
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted-2)", marginTop: 3 }}>
          {rows.length} {rows.length === 1 ? "person" : "people"} have contacted{" "}
          {viewer.workspace.name}
        </p>

        <div style={{ marginTop: 20 }}>
          {rows.length === 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "28px 24px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
              }}
            >
              No contacts yet — everyone who submits your form or emails in
              will appear here automatically.
            </div>
          )}
          {rows.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "#fff",
                border: "1px solid #efeadf",
                borderRadius: 12,
                padding: "13px 16px",
                margin: "7px 0",
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "#e7e0d3",
                  color: "#6b5f49",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12.5,
                  fontWeight: 700,
                  flex: "0 0 auto",
                }}
              >
                {initials(c.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 600,
                    color: "var(--ink)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {c.name}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--muted-2)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {c.email}
                </div>
              </div>
              <span
                style={{
                  flex: "0 0 auto",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "2px 9px",
                  borderRadius: 20,
                  color: "var(--accent-strong)",
                  background: "var(--accent-soft)",
                }}
              >
                {c.ticketCount} {c.ticketCount === 1 ? "ticket" : "tickets"}
              </span>
              <span
                style={{
                  flex: "0 0 56px",
                  textAlign: "right",
                  fontSize: 12,
                  color: "var(--muted-2)",
                }}
                title="First seen"
              >
                {relativeTime(c.firstSeen, now)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
