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
 */

function required(name: string, value: string | undefined, dev: string): string {
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${name} is not set. It has no safe default in production — see lib/config.ts.`,
    );
  }
  return dev;
}

// Public URL of THIS app (the support product), used in generated snippets.
export const APP_URL = required(
  "NEXT_PUBLIC_APP_URL",
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, ""),
  "http://localhost:8080",
);

// Domain that inbound customer email is routed to (Resend inbound).
// Per-ticket reply addresses look like: ticket+TKT-4821@inbound.yourapp.com
export const INBOUND_DOMAIN = required(
  "INBOUND_EMAIL_DOMAIN",
  process.env.INBOUND_EMAIL_DOMAIN,
  "inbound.localhost.test",
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
