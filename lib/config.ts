/**
 * Central config derived from environment. All values have safe defaults so
 * the app boots in development; override them in production via env vars.
 */

// Public URL of THIS app (the support product), used in generated snippets.
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
  "https://support.yourapp.com";

// Domain that inbound customer email is routed to (Resend inbound).
// Per-ticket reply addresses look like: ticket+TKT-4821@inbound.yourapp.com
export const INBOUND_DOMAIN =
  process.env.INBOUND_EMAIL_DOMAIN || "inbound.yourapp.com";

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
