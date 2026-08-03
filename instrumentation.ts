import * as Sentry from "@sentry/nextjs";

/**
 * Server-side registration hook (Next.js file convention). Runs once per
 * server instance, before any request is handled.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports unhandled server errors (Server Components, route handlers, Server
// Actions) that Next.js catches before our error boundaries see them.
export const onRequestError = Sentry.captureRequestError;
