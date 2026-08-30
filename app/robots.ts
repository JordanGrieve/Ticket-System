import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config";

/**
 * What crawlers may look at.
 *
 * ── WHY THE DISALLOW LIST IS THE POINT ──
 * Until this file existed there was no robots.txt at all, which does not mean
 * "index nothing" — it means "index everything you can reach". The pages that
 * matters for are not the marketing ones.
 *
 * Individual sensitive pages already set `robots: { index: false }` in their
 * own metadata, and that is the stronger signal because it survives a crawler
 * arriving at the URL from somewhere else entirely — a link in an email, a
 * referrer header, a browser extension. This file is the coarser, earlier
 * layer: it stops the crawl before the request, which also saves the database
 * lookups behind those routes.
 *
 * Both layers are kept. A meta tag cannot stop a crawl and a robots rule
 * cannot stop indexing of a URL somebody else linked to, so neither is
 * sufficient alone — a fact that is easy to state and routinely got wrong.
 *
 * ── /s/ IS DISALLOWED, WHICH IS A JUDGEMENT CALL ──
 * The hosted signup form is a real public landing page, so there is an
 * argument for letting it be found. Against: the URL carries the workspace's
 * ingestion key, and an indexed page is a harvestable list of live keys. The
 * key is public by design — it sits in the page source wherever the snippet is
 * pasted — but "discoverable by anyone reading one client's HTML" and
 * "enumerable from a search engine" are different exposures, and the second
 * one buys the client nothing: the page ranks for Postbox's domain, not their
 * brand. Double opt-in and the honeypot already make a harvested key mostly
 * useless; this keeps it from being effortless.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Everything behind a session. Crawlers get a sign-in redirect
          // rather than content, so these are wasted requests at best.
          "/inbox",
          "/tickets/",
          "/settings/",
          "/newsletters",
          "/subscribers",
          "/search",
          "/admin",
          "/no-access",
          // Per-recipient and per-workspace URLs. See the note above.
          "/u/",
          "/s/",
          "/api/",
          // Sentry's tunnel.
          "/monitoring",
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
