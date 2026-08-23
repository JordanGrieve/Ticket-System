import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Auth boundary (Next.js "proxy" convention — formerly middleware).
 *
 * Dashboard pages require a signed-in user (redirected to /sign-in).
 * API routes are left "public" here and enforce their own auth inside the
 * handler — public ingestion + the inbound webhook must be reachable with no
 * Clerk session, and the authed API routes return 401 JSON (not an HTML
 * redirect) when unauthenticated.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/terms",
  "/privacy",
  // The pricing page. Public for the obvious reason — it is a marketing page
  // and the whole point is that people read it before they have an account —
  // but worth a line rather than folding it in silently: it is the first route
  // added here whose omission would not 404 loudly in testing. It would 307 a
  // logged-out visitor to /sign-in, i.e. the pricing link on the homepage
  // would quietly become a sign-in wall for exactly the people it is for.
  "/pricing",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/(.*)",
  // Public unsubscribe. Must work with no session: the RFC 8058 one-click POST
  // arrives unattended from Gmail/Yahoo with no cookies, and the human GET
  // arrives from a mail client. Without this line clerkMiddleware 307s both to
  // /sign-in and the opt-out silently does not happen — which is a legal
  // breach, not a broken page. The token in the path is the whole of the
  // authorisation; see app/u/[token]/route.ts.
  "/u/(.*)",
  // Public newsletter signup: the hosted form, and the pages the double
  // opt-in link lands on. Exactly the same requirement as /u/ above, and it
  // was missed in the same way — the endpoints under /api/ were reachable
  // (they match "/api/(.*)"), so every unit test passed and the feature was
  // still completely unreachable in production. A stranger clicking a
  // confirmation link in their email has no Clerk session and never will;
  // without this line they get a 404 and their consent is never recorded.
  "/s/(.*)",
  // Sentry's tunnelRoute — browser error/trace events POST here and are
  // forwarded to Sentry. Must not require a session.
  "/monitoring(.*)",
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  },
  {
    // Clerk production hardening: only these origins may carry our sessions
    // (protects against subdomain cookie-leak / CSRF-style attacks).
    authorizedParties: [
      "https://postbox.help",
      "http://localhost:3000",
      "http://localhost:8080",
    ],
  },
);

export const config = {
  matcher: [
    // Run on everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always on API routes.
    "/(api|trpc)(.*)",
    // Clerk's handshake / keyless proxy path.
    "/__clerk/:path*",
  ],
};
