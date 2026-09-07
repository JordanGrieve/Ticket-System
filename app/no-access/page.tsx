import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthProvider from "@/components/AuthProvider";

/**
 * Reached only by somebody already signed in who has no workspace, so there is
 * nothing here for a search engine. robots.txt already disallows the path, but
 * that stops a crawl rather than an index — a URL linked from elsewhere can
 * still be indexed without ever being fetched, and the meta tag is what
 * actually prevents it.
 *
 * Declaring it also stops this page inheriting the root layout's canonical and
 * announcing itself as a duplicate of the homepage. See app/pricing/page.tsx.
 */
export const metadata: Metadata = {
  title: "No access",
  robots: { index: false, follow: false },
};
// A third sign-out, easy to miss. Nobody reaches /no-access mid-impersonation
// (an operator has an admin row and lands on /admin), so this one closes no
// audit session in practice — it is routed through the same component anyway
// so that "sign out" means one thing everywhere, and so the next person to
// copy this page copies the right button. It still clears any stale
// pb_admin_ws left in the browser.
import AuditedSignOutButton from "@/components/AuditedSignOutButton";
import { resolveViewer } from "@/lib/viewer";
import { PostboxLockup } from "@/components/Logo";

/**
 * Shown to signed-in users with no workspace and no invite (invite-only
 * mode). If they DO have access (invite claimed meanwhile, or an admin),
 * bounce them to the right place instead.
 */
export default async function NoAccessPage() {
  const viewer = await resolveViewer();
  if (viewer.isAdmin) redirect("/admin");
  if (viewer.workspace) redirect("/inbox");

  return (
    <AuthProvider>
      <div
        style={{
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
            <PostboxLockup />
          </div>

          <h1 style={{ fontSize: "1.375rem", fontWeight: 700, marginBottom: 10 }}>
            Postbox is invite-only
          </h1>
          <p style={{ fontSize: "0.90625rem", lineHeight: 1.65, color: "var(--muted)", margin: 0 }}>
            You&rsquo;re signed in as <b style={{ color: "var(--ink)" }}>{viewer.email}</b>,
            but there&rsquo;s no workspace linked to that email. If your business
            uses Postbox, ask your provider to invite this address — or sign in
            with the email your invitation was sent to.
          </p>

          <div style={{ marginTop: 26 }}>
            <AuditedSignOutButton
              style={{
                height: 40,
                padding: "0 20px",
                borderRadius: 10,
                /*
                  --accent-grad, not --accent. White on the flat accent is
                  3.20:1 in forest and 3.01:1 in slate, against the 4.5:1 that
                  13.5px text needs; the gradient's stops are all guarded to
                  clear AA in tests/contrast-tokens.test.ts.

                  The same bug was fixed in four CSS rules on 6 Sep and a
                  source scan was added to stop it coming back. It came back
                  here anyway, because the scan reads stylesheets and this is
                  an inline style in a .tsx -- so the scan now reads both.
                */
                background: "var(--accent-grad)",
                color: "#fff",
                fontSize: "0.84375rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Sign out
            </AuditedSignOutButton>
          </div>
        </div>
      </div>
    </AuthProvider>
  );
}
