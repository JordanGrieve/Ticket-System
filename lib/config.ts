/**
 * Central config derived from environment.
 *
 * The placeholder defaults exist so the app boots in development and so CI can
 * build with dummy values. In production they are REFUSED rather than used,
 * because every one of them fails silently and invisibly if it survives to
 * runtime:
 *
 *  - APP_URL wrong  → the install snippet handed to a client posts their
 *    customers' enquiries at a domain we do not own.
 *  - INBOUND_DOMAIN wrong → reply-to addresses are unroutable, so customer
 *    replies vanish, AND the auto-reply self-address guard stops matching,
 *    removing a mail-loop defence.
 * EMAIL_FROM_ADDRESS is deliberately NOT in that list. Its default is
 * replies@postbox.help — a real address on our own verified domain, not a
 * placeholder — and it is currently absent from .env.local, which means
 * production has been running on the default and working correctly. Making it
 * required would turn a working deployment into a boot crash the moment it
 * shipped, which is a worse outcome than the thing it guards against. It stays
 * defaulted until it is confirmed set in Vercel; then it can join the others.
 *
 * None of these break the build, and none raise an error at the point of use —
 * they just quietly do the wrong thing to real customers. A refusal at boot is
 * noisy and immediate, which is the whole point.
 *
 * SERVER ONLY. This module reads non-NEXT_PUBLIC_ environment variables, which
 * simply do not exist in a browser. It shipped to the client once already, via
 * lib/tickets → MailNavShell, and took production down (Sentry POSTBOX-6). The
 * `server-only` import below makes that a build error rather than a silent leak
 * — which matters most for whatever gets added to this file next, since a
 * secret placed here would otherwise go out in a public JS chunk.
 */
import "server-only";

/**
 * Reports a missing variable loudly WITHOUT throwing.
 *
 * This threw once. It took production down: INBOUND_EMAIL_DOMAIN turned out not
 * to be set in Vercel, so every authed page 500'd the moment it deployed. The
 * reasoning that put it there was wrong in a specific and instructive way — the
 * variable is present in .env.local, and inbound mail demonstrably works in
 * production, so it was assumed to be configured. Neither fact implies the
 * other: .env.local is local only, and inbound mail working proves the provider
 * routes to us, not that the app can name its own inbound domain.
 *
 * A missing value here is a real fault and still deserves attention, but taking
 * the whole app down for the pilot client is a worse outcome than degraded mail
 * addressing. It logs — which reaches Sentry — and carries on.
 */
function orDefault(name: string, value: string | undefined, fallback: string): string {
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    console.error(
      `[config] ${name} is not set; falling back to ${fallback}. ` +
        `This is a misconfiguration — set it in the deployment environment.`,
    );
  }
  return fallback;
}

// Public URL of THIS app (the support product), used in generated snippets.
export const APP_URL = orDefault(
  "NEXT_PUBLIC_APP_URL",
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, ""),
  "https://postbox.help",
);

// Domain that inbound customer email is routed to (Resend inbound).
// Per-ticket reply addresses look like: ticket+TKT-4821@inbound.yourapp.com
export const INBOUND_DOMAIN = orDefault(
  "INBOUND_EMAIL_DOMAIN",
  process.env.INBOUND_EMAIL_DOMAIN,
  "postbox.help",
);

// Address ticket replies are sent FROM. Must be on a domain verified in
// Resend (ours), NOT the client's — Resend rejects unverified from-domains.
// The client's name still appears as the display name, and the per-ticket
// Reply-To keeps threading working.
export const EMAIL_FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS || "replies@postbox.help";

// Self-serve sign-up. False (default) = invite-only: signing in without an
// admin-created invite (or existing workspace) shows /no-access instead of
// auto-provisioning a workspace. Strangers must never get a workspace — it
// would hand them outbound email from our domain.
export const OPEN_SIGNUP = process.env.OPEN_SIGNUP === "true";

/**
 * The ingestion key of Postbox's OWN workspace, so /contact can post to it.
 *
 * ── WHY POSTBOX HAS A WORKSPACE ──
 * Until this existed there was no way for anyone to contact Postbox at all.
 * The pricing page's only call to action, "Get in touch", linked to /sign-in —
 * a Google sign-in wall shown to a prospect who by definition has no account.
 * It was the single conversion path on the page and it was a dead end.
 *
 * The fix is the product. /contact is an ordinary contact form posting to the
 * ordinary public ingestion endpoint with an ordinary workspace key, exactly
 * as a client's own site does. Nothing bespoke: if this path breaks, it breaks
 * for every client too and somebody notices immediately.
 *
 * It is also what makes "Priority support from us" on the Business plan a
 * thing the product can deliver rather than a promise with no channel behind
 * it — the admin console records that gap under PIVOT 26.
 *
 * ── EMPTY IS A SUPPORTED STATE ──
 * No orDefault and no fallback: a wrong key here would post real enquiries
 * into the wrong workspace, which is worse than not accepting them. Unset
 * means /contact says it is not configured yet rather than silently posting
 * nowhere. Set it once the workspace exists — see HUMAN_ACTIONS.md.
 */
export const POSTBOX_CONTACT_KEY =
  process.env.POSTBOX_CONTACT_KEY?.trim() || null;
