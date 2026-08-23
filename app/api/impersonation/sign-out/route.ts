import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { findAdminByClerkId } from "@/lib/admin";
import { ADMIN_IMP_COOKIE, endOpenSessionsForAdmin } from "@/lib/impersonation";
import { ADMIN_WS_COOKIE } from "@/lib/viewer";

/**
 * Close impersonation on the way out of the building.
 *
 * ── The hole this fills ──
 *
 * Both sign-out buttons were Clerk's client-side `<SignOutButton>`. That clears
 * Clerk's session cookie in the browser and navigates away — no server code of
 * ours runs at any point. So an operator who signed out while inside a client
 * workspace left `pb_admin_ws` and `pb_admin_imp` sitting in their browser and,
 * far worse, left the impersonation_sessions row OPEN. Nothing ever closes it:
 * `endedAt` stays null forever and the access log describes the visit as
 * "Abandoned" (lib/impersonation.sessionState) once the heartbeat goes quiet.
 *
 * "Abandoned" is meant to mean "we genuinely do not know when they left". A
 * clean sign-out is the one case where we know exactly when they left, so
 * recording it as an unknown is a lie in the one document whose entire purpose
 * is to not lie to clients about who was in their data.
 *
 * ── Why a route handler ──
 *
 * @clerk/nextjs v7 has no server-side sign-out; the Clerk half must happen in
 * the browser. So the client calls here FIRST, waits, and only then asks Clerk
 * to sign out. See components/AuditedSignOutButton.tsx.
 *
 * ── Why this cannot use stopImpersonatingAction ──
 *
 * app/(admin)/admin/actions.ts already does exactly this work, and reusing it
 * was the first instinct. It cannot be reused as-is: it opens with
 * `requireAdminRow()`, which `redirect()`s any non-admin to /inbox, and it
 * finishes with its own `redirect("/admin?section=access")`. Both are wrong
 * here. Every sign-out in the app routes through this endpoint, and most of
 * them belong to ordinary clients who have no admin row at all — for them the
 * correct behaviour is "do nothing, quietly, and let the sign-out proceed", not
 * a redirect. The shared part is the two lib/impersonation calls, and those are
 * what is actually reused.
 *
 * ── Never trust pb_admin_imp ──
 *
 * The cookie is attacker-writable and only *names* a row (lib/viewer explains
 * this at length). Closing whatever row it points at would let anyone mark
 * another operator's live session as cleanly "signed_out" while they are still
 * inside a client — poisoning the log in precisely the direction that hides
 * access. So the id is never read. We resolve the admin from Clerk's session
 * and close the sessions that are actually theirs; `endOpenSessionsForAdmin`
 * is scoped by `adminId`, so a forged cookie changes nothing.
 *
 * ── Signing out must always work ──
 *
 * Everything above is best-effort and wrapped. A database blip, a closed Neon
 * connection, a schema drift — none of them may leave someone stuck signed in.
 * The cookies are cleared and 200 returned whatever happened; the client
 * proceeds to Clerk's sign-out even on a network error. An audit write that
 * fails is a logged fault, not a locked door.
 */
export async function POST(): Promise<Response> {
  const store = await cookies();
  let closed = false;

  try {
    const { userId } = await auth();
    if (userId) {
      // Only admins can hold an open session, and any admin who has ever
      // entered a client got their Clerk id linked on the way in
      // (resolveViewer → linkAdminClerkId), so this lookup cannot miss one.
      // Deliberately no currentUser()/email fallback: it costs a Clerk API
      // call on every sign-out in the product to cover a state that cannot
      // exist.
      const admin = await findAdminByClerkId(userId);
      if (admin) {
        // Not "stopped": that reason means they clicked "Stop impersonating"
        // and stayed in the admin console. Here they left Postbox altogether,
        // which is what the log should say. `ended_reason` is a plain text
        // column, so the union gained a member without a migration.
        await endOpenSessionsForAdmin(admin.id, "signed_out");
        closed = true;
      }
    }
  } catch (err) {
    // Reaches Sentry. The sign-out still completes.
    console.error(
      "[impersonation] sign-out could not close the open session; " +
        "the audit row will read as abandoned",
      err,
    );
  }

  // Unconditional, and outside the try: leaving these behind on a signed-out
  // browser is what let a stale workspace selection greet the next person to
  // sign in on the same machine. Both were set with path "/", which is what
  // delete() targets by default.
  store.delete(ADMIN_WS_COOKIE);
  store.delete(ADMIN_IMP_COOKIE);

  // `closed` is for the caller's benefit only; the client ignores it and signs
  // out regardless.
  return json({ ok: true, closed });
}
