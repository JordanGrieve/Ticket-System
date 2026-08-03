import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "jordangrievedevelopment",
  project: process.env.SENTRY_PROJECT ?? "postbox",

  // Source-map upload; skipped automatically when the token is absent.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,

  // Routes browser events through our own domain so ad-blockers don't eat them.
  // NOTE: /monitoring must stay a public route in proxy.ts or Clerk will
  // redirect these POSTs to /sign-in.
  tunnelRoute: "/monitoring",

  silent: !process.env.CI,

  // No webpack.treeshake options: Next 16 builds with Turbopack by default and
  // those options are webpack-only.
});
