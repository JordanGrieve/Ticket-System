"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useClerk } from "@clerk/nextjs";

/**
 * The only way to sign out of Postbox.
 *
 * Clerk's own `<SignOutButton>` runs entirely in the browser: it drops Clerk's
 * cookie and navigates, and no server code of ours is involved. That is fine
 * for a plain tenant and wrong for an operator, who may be sitting inside a
 * client's workspace with an open row in impersonation_sessions and two admin
 * cookies in their browser. Signing out that way abandoned the row — see
 * app/api/impersonation/sign-out/route.ts for what that costs.
 *
 * So: our server first, Clerk second. The POST closes the session and clears
 * `pb_admin_ws` / `pb_admin_imp`; only then does Clerk's sign-out run.
 *
 * ORDER MATTERS AND CANNOT BE PARALLELISED. The endpoint identifies the
 * operator from Clerk's session, so it has to be reached while that session is
 * still valid. Firing both at once races Clerk's cookie clear and would
 * intermittently produce the exact bug this replaces.
 *
 * FAILURE IS NOT ALLOWED TO TRAP ANYONE. Offline, 500, DNS, blocked request —
 * the catch swallows all of it and sign-out proceeds. Being unable to sign out
 * because an audit write failed would be a far worse bug than a stale audit
 * row, especially on a shared machine.
 *
 * Presentation is entirely the caller's: this renders a bare <button> and
 * passes className/style straight through, because the three call sites look
 * nothing alike (a menu item in the mail nav, a sidebar button in admin, a
 * primary button on /no-access) and none of their styling belongs here.
 */
export default function AuditedSignOutButton({
  className,
  style,
  role,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  /** e.g. "menuitem" when the button sits inside a role="menu" container. */
  role?: string;
  children: ReactNode;
}) {
  const { signOut } = useClerk();
  // A ref, not state: double-clicking must not fire two sign-outs, but a
  // re-render here would be pointless — the page is about to be replaced.
  const leaving = useRef(false);

  async function handleSignOut() {
    if (leaving.current) return;
    leaving.current = true;

    try {
      await fetch("/api/impersonation/sign-out", {
        method: "POST",
        // Same-origin so Clerk's session cookie is sent; the endpoint needs it
        // to know which operator is leaving.
        credentials: "same-origin",
      });
    } catch {
      // Deliberately empty. The endpoint logs its own failures server-side;
      // a client that cannot reach it must still get signed out.
    }

    // ClerkProvider sets no afterSignOutUrl, so "/" is stated here rather than
    // left to a default that a later provider change could quietly move.
    await signOut({ redirectUrl: "/" });
  }

  return (
    <button type="button" className={className} style={style} role={role} onClick={handleSignOut}>
      {children}
    </button>
  );
}
