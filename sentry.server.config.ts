import * as Sentry from "@sentry/nextjs";

/**
 * Node.js server runtime. Loaded from instrumentation.ts's register().
 *
 * With no SENTRY_DSN set the SDK initialises as a no-op and sends nothing —
 * that is the deliberate state until the DSN is added to Vercel + .env.local.
 *
 * PII: this app processes customer support mail (names, addresses, message
 * bodies). We deliberately do NOT pass `dataCollection`, so the SDK falls back
 * to sendDefaultPii = false and leaves request bodies, headers and user info
 * out of events. `includeLocalVariables` is off for the same reason — locals in
 * lib/notify.ts and app/api/inbound hold raw customer content.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // 100% in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  includeLocalVariables: false,

  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});
