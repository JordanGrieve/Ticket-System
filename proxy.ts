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
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always on API routes.
    "/(api|trpc)(.*)",
  ],
};
