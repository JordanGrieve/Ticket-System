import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Every public page segment must be in the auth matcher.
 *
 * This exists because the newsletter signup pages shipped unreachable. The
 * routes under app/s/ need no session — a stranger pressing a confirmation
 * link in their email has no Clerk account and never will — but /s/ was not
 * added to isPublicRoute, so clerkMiddleware protected them and the public got
 * a 404. Everything else was green: 371 unit tests, tsc, lint. The endpoints
 * under /api/ were reachable because "/api/(.*)" already matched, so the half
 * with tests worked and the half without did not.
 *
 * The same mistake had already been made once, for the unsubscribe pages,
 * where it is a legal breach rather than a broken page — app/u/layout.tsx and
 * the comment in proxy.ts both say so at length. Documenting a trap twice did
 * not stop it happening a third time, so here it is as a test.
 *
 * Parsing the source rather than importing it is deliberate: importing
 * proxy.ts pulls in Clerk and its environment, which is exactly the machinery
 * this needs to run without. tests/campaign-schedule.test.ts reads vercel.json
 * the same way and for the same reason.
 */

const PROXY = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");

/**
 * Page segments that must never require a session, and why. Adding a public
 * area to app/ without adding it here is the failure this file catches — so
 * the list is the contract, not a mirror of the implementation.
 */
const PUBLIC_SEGMENTS: Array<{ dir: string; pattern: string; why: string }> = [
  {
    dir: "u",
    pattern: "/u/(.*)",
    why: "Unsubscribe. An unattended RFC 8058 POST from Gmail carries no cookies; failing to opt someone out is a legal breach.",
  },
  {
    dir: "s",
    pattern: "/s/(.*)",
    why: "Newsletter signup and double opt-in confirmation. The person pressing the link has no account here.",
  },
];

describe("public route matcher", () => {
  it.each(PUBLIC_SEGMENTS)(
    "app/$dir is declared public in proxy.ts ($why)",
    ({ dir, pattern }) => {
      // Guard against the list going stale in the other direction: if the
      // directory is gone, this test should be updated, not silently passing.
      expect(
        existsSync(join(process.cwd(), "app", dir)),
        `app/${dir} does not exist — update PUBLIC_SEGMENTS`,
      ).toBe(true);

      expect(PROXY).toContain(`"${pattern}"`);
    },
  );

  it("declares every app segment as either public or deliberately protected", () => {
    // Catches a NEW public area being added without a decision being made
    // about it.
    //
    // Route groups in parentheses are layout-only and never appear in a URL,
    // so the GROUP is not a segment — but what is inside it is. This used to
    // skip them entirely, which left a blind spot precisely where it mattered:
    // app/(legal)/ holds /terms and /privacy, both of which must be public, so
    // the next public page added there would have gone unnoticed. It did, when
    // /pricing was added. Now the groups are flattened into the segments they
    // actually produce.
    // Every one of these requires a session, and that is the point of them.
    // They were invisible to this test until route groups were flattened —
    // they live under app/(dashboard) and app/(admin) — so listing them here
    // is not bookkeeping: it is the first time the guard has actually asserted
    // that the inbox and the operator console are not public.
    const KNOWN_PROTECTED = [
      "no-access",
      "admin",
      "inbox",
      "newsletters",
      "search",
      "settings",
      "subscribers",
      "tickets",
    ];
    const appDir = join(process.cwd(), "app");

    const dirsIn = (p: string) =>
      readdirSync(p, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    const segments = dirsIn(appDir).flatMap((name) => {
      if (name.startsWith("_") || name === "api") return [];
      // A route group contributes its children's names, not its own.
      if (name.startsWith("(")) {
        return dirsIn(join(appDir, name)).filter(
          (child) => !child.startsWith("_") && !child.startsWith("("),
        );
      }
      return [name];
    });

    const undeclared = segments.filter(
      (n) =>
        !PUBLIC_SEGMENTS.some((p) => p.dir === n) &&
        !KNOWN_PROTECTED.includes(n) &&
        // Anything already named in the matcher — sign-in, sign-up, etc.
        !PROXY.includes(`"/${n}`),
    );

    expect(
      undeclared,
      `New app segment(s) with no auth decision: ${undeclared.join(", ")}. ` +
        "Add to PUBLIC_SEGMENTS and proxy.ts if strangers must reach them, " +
        "or to KNOWN_PROTECTED if they require a session.",
    ).toEqual([]);
  });
});
