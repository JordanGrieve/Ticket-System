import { SignOutButton } from "@clerk/nextjs";
import { resolveViewer } from "@/lib/viewer";
import { listWorkspaceSummaries } from "@/lib/data";
import { listAdmins } from "@/lib/admin";
import {
  selectWorkspaceAction,
  addAdminAction,
  createClientAction,
} from "./actions";

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; emailed?: string }>;
}) {
  const { error, created, emailed } = await searchParams;
  const viewer = await resolveViewer();
  const [workspaces, admins] = await Promise.all([
    listWorkspaceSummaries(),
    listAdmins(),
  ]);

  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "40px 24px 80px" }}>
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "var(--accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 18,
          }}
        >
          p
        </div>
        <span style={{ fontSize: 20, fontWeight: 700 }}>postbox</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--accent-strong)",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-line)",
            borderRadius: 20,
            padding: "3px 9px",
          }}
        >
          Admin
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{viewer.email}</span>
          <SignOutButton>
            <button
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#9a5a4a",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "22px 0 4px" }}>
        Clients
      </h1>
      <p style={{ color: "var(--muted)", margin: "0 0 22px", fontSize: 14.5 }}>
        Open any workspace to view and help with its tickets.
      </p>

      {/* status banners from the create-client action */}
      {error && (
        <div style={{ ...banner, background: "#fbe9e5", border: "1px solid #efcabf", color: "#9a4a33" }}>
          {error}
        </div>
      )}
      {created && (
        <div style={{ ...banner, background: "#e6f2ec", border: "1px solid #cbe3d6", color: "#2c7a54" }}>
          {emailed === "1" ? (
            <>
              <b>{created}</b> is ready — we&rsquo;ve emailed your client an
              invitation to sign up.
            </>
          ) : (
            <>
              <b>{created}</b> is ready, but the invite email couldn&rsquo;t be
              sent. Ask your client to sign up at <b>postbox.help</b> using the
              email you entered — they&rsquo;ll land straight in their workspace.
            </>
          )}
        </div>
      )}

      {/* onboard a new client */}
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 18,
          marginBottom: 22,
        }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>
          New client
        </div>
        <p style={{ color: "var(--muted)", margin: "0 0 12px", fontSize: 13 }}>
          Creates their workspace now. When they sign up with this email, they
          connect to it automatically.
        </p>
        <form
          action={createClientAction}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input
            type="text"
            name="name"
            required
            placeholder="Business name — e.g. Open Door Bakery"
            style={{ ...inputStyle, flex: "2 1 220px" }}
          />
          <input
            type="email"
            name="email"
            required
            placeholder="Client's login email"
            style={{ ...inputStyle, flex: "2 1 220px" }}
          />
          <button type="submit" style={{ ...buttonStyle, flex: "0 0 auto" }}>
            Create workspace
          </button>
        </form>
      </div>

      {/* workspaces */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {workspaces.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No client workspaces yet.</p>
        )}
        {workspaces.map((w) => (
          <div
            key={w.id}
            style={{
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{w.name}</div>
                {w.pending && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      color: "#b07d1a",
                      background: "#f8ecd4",
                      border: "1px solid #efe0bf",
                      borderRadius: 20,
                      padding: "2px 8px",
                    }}
                  >
                    Awaiting sign-in
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 2 }}>
                {w.ownerEmail ?? w.inboundEmail}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
              <span>
                <strong style={{ color: "var(--accent-strong)" }}>{w.openCount}</strong>{" "}
                <span style={{ color: "var(--muted)" }}>open</span>
              </span>
              <span>
                <strong>{w.totalCount}</strong>{" "}
                <span style={{ color: "var(--muted)" }}>total</span>
              </span>
            </div>
            <form action={selectWorkspaceAction} style={{ marginTop: "auto" }}>
              <input type="hidden" name="workspaceId" value={w.id} />
              <button
                type="submit"
                style={{
                  width: "100%",
                  height: 36,
                  borderRadius: 9,
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 13.5,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Open workspace →
              </button>
            </form>
          </div>
        ))}
      </div>

      {/* team / admins */}
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "44px 0 4px" }}>Team</h2>
      <p style={{ color: "var(--muted)", margin: "0 0 18px", fontSize: 14.5 }}>
        Admins can see and help with every client. Add a teammate&rsquo;s email to
        grant them the same access.
      </p>

      <div
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 18,
          maxWidth: 520,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {admins.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 14,
              }}
            >
              <span>{a.email}</span>
              {a.email === viewer.email && (
                <span style={{ fontSize: 12, color: "var(--muted-2)" }}>you</span>
              )}
            </div>
          ))}
        </div>

        <form action={addAdminAction} style={{ display: "flex", gap: 8 }}>
          <input
            type="email"
            name="email"
            required
            placeholder="teammate@example.com"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" style={buttonStyle}>
            Add admin
          </button>
        </form>
      </div>
    </div>
  );
}

const banner: React.CSSProperties = {
  borderRadius: 11,
  padding: "12px 16px",
  fontSize: 13.5,
  lineHeight: 1.5,
  marginBottom: 16,
};

const inputStyle: React.CSSProperties = {
  height: 38,
  borderRadius: 9,
  border: "1px solid var(--border)",
  padding: "0 12px",
  fontSize: 14,
  background: "var(--app-bg)",
};

const buttonStyle: React.CSSProperties = {
  height: 38,
  padding: "0 16px",
  borderRadius: 9,
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13.5,
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
};
