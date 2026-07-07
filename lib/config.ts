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
