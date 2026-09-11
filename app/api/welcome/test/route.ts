import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace, resolveViewer } from "@/lib/viewer";
import { rateLimitDurable } from "@/lib/rate-limit-store";
import { sendWelcomeEmail } from "@/lib/welcome-store";

/**
 * POST /api/welcome/test (authed) — send this workspace's welcome email to
 * the caller's own address.
 *
 * ── WHY THIS EXISTS ──
 * Two reasons, and the second is the one that made it urgent. A client should
 * be able to see the email their customers will get before a customer gets
 * it. And on 11 Sep 2026 the first real welcome did not arrive, with no way
 * to find out why: the send names five distinct refusals and every one of
 * them was invisible outside a Vercel log nobody on this project can read.
 * A feature whose failure mode is silence is a feature nobody can support.
 *
 * The reason IS returned here, unlike every other send in the product. That
 * is safe precisely because this one goes to the authenticated caller's own
 * address — there is no stranger to leak anything to, and the person reading
 * it is the only person who can fix it.
 *
 * Same address rule as the campaign test-send: the recipient is the viewer,
 * never a value from the request. A route that sent "a test" to an address in
 * the body would be an open relay wearing a settings screen.
 */

/** What to tell the client for each refusal. */
const EXPLAIN: Record<string, string> = {
  not_configured: "Save the welcome email first.",
  disabled: "Turn the welcome email on first.",
  no_postal_address:
    "Add your postal address under Sender identity. Marketing email has to carry one.",
  no_secret:
    "This deployment has no signing secret, so the unsubscribe link could not be made. We have been told about this one.",
  send_failed:
    "The email provider refused it. We have been told about this one.",
};

export async function POST() {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const viewer = await resolveViewer();
  const to = (viewer.email ?? "").trim();
  if (!to) {
    return json(
      { error: "Your account has no email address on it." },
      { status: 400 },
    );
  }

  // Per-viewer, not per-IP: the address is fixed to the caller, so this is
  // not holding back abuse — it stops a stuck button putting forty copies in
  // somebody's own inbox.
  const limit = await rateLimitDurable(`welcome-test:${userId}`, {
    max: 6,
    windowMs: 600_000,
  });
  if (!limit.ok) {
    return json(
      {
        error: `Too many tests. Try again in ${Math.ceil(
          limit.retryAfterSeconds / 60,
        )} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const result = await sendWelcomeEmail({
    workspaceId: workspace.id,
    email: to,
    // The name a real subscriber would have supplied. Null renders the
    // fallback greeting, which is what somebody who signed up without a name
    // receives — so a test shows the worst case rather than the best one.
    name: null,
  });

  if (result.sent) return json({ ok: true, sent: true, to });

  return json({
    ok: true,
    sent: false,
    reason: result.reason,
    message: EXPLAIN[result.reason] ?? "It could not be sent.",
    // Only ever present for send_failed, and only ever seen by the caller
    // asking about their own address. See WelcomeSendResult.detail.
    ...(result.detail ? { detail: result.detail } : {}),
  });
}
