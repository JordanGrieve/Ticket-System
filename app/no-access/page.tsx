import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { resolveViewer } from "@/lib/viewer";
import { accentVars } from "@/lib/theme";

/**
 * Shown to signed-in users with no workspace and no invite (invite-only
 * mode). If they DO have access (invite claimed meanwhile, or an admin),
 * bounce them to the right place instead.
 */
export default async function NoAccessPage() {
  const viewer = await resolveViewer();
  if (viewer.isAdmin) redirect("/admin");
  if (viewer.workspace) redirect("/");

  return (
    <div
      style={{
        ...accentVars("terracotta"),
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--app-bg)",
        color: "var(--ink)",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 26,
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
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>
          Postbox is invite-only
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--muted)", margin: 0 }}>
          You&rsquo;re signed in as <b style={{ color: "var(--ink)" }}>{viewer.email}</b>,
          but there&rsquo;s no workspace linked to that email. If your business
          uses Postbox, ask your provider to invite this address — or sign in
          with the email your invitation was sent to.
        </p>

        <div style={{ marginTop: 26 }}>
          <SignOutButton>
            <button
              style={{
                height: 40,
                padding: "0 20px",
                borderRadius: 10,
                background: "var(--accent)",
                color: "#fff",
                fontSize: 13.5,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
