import * as Sentry from "@sentry/nextjs";

/**
 * Edge runtime (proxy.ts runs here). Loaded from instrumentation.ts's
 * register(). See sentry.server.config.ts for the PII rationale.
 */
Sentry.init({
  // See sentry.server.config.ts — one DSN, either variable name.
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});
