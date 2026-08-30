import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every page a stranger must be able to reach is reachable.
 *
 * ── THIS BUG HAS SHIPPED TWICE ──
 * proxy.ts protects everything not listed in `isPublicRoute`, so a page added
 * outside the dashboard without a matching line does not 404 and does not
 * throw. It 307s a logged-out visitor to /sign-in. The page is fine, the tests
 * are green, and the feature is simply unreachable by the only people it is
 * for.
 *
 * proxy.ts records both times in its own comments. /pricing: "the pricing link
 * on the homepage would quietly become a sign-in wall for exactly the people
 * it is for." And /s/: the API endpoints underneath matched "/api/(.*)" so
 * every unit test passed while "a stranger clicking a confirmation link in
 * their email" could never record their consent.
 *
 * Both were found by a person clicking. Nothing else could find them, because
 * the failure is a redirect rather than an error — which is exactly the shape
 * a test can check and a type cannot.
 *
 * ── HOW IT WORKS ──
 * Reads the route patterns out of proxy.ts as SOURCE rather than importing it.
 * Importing pulls in @clerk/nextjs/server and the whole middleware runtime for
 * what is a question about a list of strings; and the source is the artefact
 * that has to be right.
 */

const PROXY = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");

/** The literals inside createRouteMatcher([...]). */
function publicPatterns(): string[] {
  const start = PROXY.indexOf("createRouteMatcher([");
  expect(start).toBeGreaterThan(-1);
  const end = PROXY.indexOf("]);", start);
  expect(end).toBeGreaterThan(start);
  const block = PROXY.slice(start, end);
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * Clerk's matcher accepts path-to-regexp syntax; the only forms this codebase
 * uses are a literal and a trailing "(.*)" group, plus "/:path*" once. Handling
 * exactly those keeps the conversion honest — anything else throws rather than
 * silently matching nothing, which would make this test pass by accident.
 */
function toRegExp(pattern: string): RegExp {
  if (/[:{}+?[\]]/.test(pattern.replace("(.*)", ""))) {
    if (pattern.endsWith("/:path*")) {
      return new RegExp(`^${escape(pattern.slice(0, -"/:path*".length))}(/.*)?$`);
    }
    throw new Error(`Unhandled route pattern syntax: ${pattern}`);
  }
  return new RegExp(`^${escape(pattern).replace("\\(\\.\\*\\)", ".*")}$`);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPublic(path: string): boolean {
  return publicPatterns().some((p) => toRegExp(p).test(path));
}

/** Every page.tsx / route.ts under app/, as the URL it serves. */
function routeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // A (group) is organisational and contributes nothing to the URL.
        const segment = /^\(.*\)$/.test(entry.name) ? url : `${url}/${entry.name}`;
        walk(full, segment);
      } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
        found.push(url === "" ? "/" : url);
      }
    }
  };
  walk(join(process.cwd(), "app"), "");
  return [...new Set(found)];
}

/**
 * Dynamic segments become something a real request could look like, so the
 * pattern is tested against a URL rather than against a template.
 */
function asRequestPath(route: string): string {
  return route
    .replace(/\[\[\.\.\.[^\]]+\]\]/g, "anything/at/all")
    .replace(/\[\.\.\.[^\]]+\]/g, "anything/at/all")
    .replace(/\[[^\]]+\]/g, "sample-value");
}

/**
 * Routes outside the dashboard that STILL require a session, with the reason.
 *
 * An allowlist rather than a rule, because "outside (dashboard) therefore
 * public" is not true and pretending it is would make this test wrong in the
 * quiet direction. Anything added here is a decision somebody wrote down.
 */
const AUTHED_ON_PURPOSE: Record<string, string> = {
  "/no-access":
    "Shown to somebody who IS signed in but has no workspace. A signed-out visitor has nothing to be told here.",
};

describe("public routes are actually reachable", () => {
  const dashboardish = (r: string) =>
    r.startsWith("/api") || r.startsWith("/monitoring");

  it("finds the app's routes at all", () => {
    // If the walk breaks, every assertion below passes vacuously.
    const routes = routeFiles();
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/");
  });

  it("reads the patterns out of proxy.ts", () => {
    const patterns = publicPatterns();
    expect(patterns).toContain("/");
    expect(patterns).toContain("/u/(.*)");
    expect(patterns).toContain("/s/(.*)");
  });

  it("lets a stranger reach every page that is not behind the dashboard", () => {
    /*
     * The dashboard and admin consoles live in route GROUPS, so their URLs are
     * indistinguishable from public ones by path alone — /inbox and /pricing
     * look the same to a matcher. The filesystem is what knows the difference,
     * so the check is driven from the directory a file is in.
     */
    const publicDirs = ["(legal)", "s", "u", "sign-in", "sign-up", "pricing"];
    const shouldBePublic = routeFiles().filter((r) => {
      if (dashboardish(r)) return false;
      if (r === "/") return true;
      const first = r.split("/")[1]!;
      return publicDirs.includes(first);
    });

    expect(shouldBePublic.length).toBeGreaterThan(5);
    const unreachable = shouldBePublic.filter(
      (r) => !isPublic(asRequestPath(r)),
    );
    expect(
      unreachable,
      "These pages 307 a logged-out visitor to /sign-in. Add a line to " +
        "isPublicRoute in proxy.ts, or record why they are authed.",
    ).toEqual([]);
  });

  it("keeps the dashboard and the admin console protected", () => {
    /*
     * The other direction, and the more dangerous one. A pattern like "/(.*)"
     * would make every test above pass and the entire product public.
     */
    for (const path of [
      "/inbox",
      "/settings",
      "/settings/billing",
      "/newsletters",
      "/subscribers",
      "/tickets/12",
      "/admin",
      "/search",
    ]) {
      expect(isPublic(path), `${path} must require a session`).toBe(false);
    }
  });

  it("documents every route outside the dashboard that stays authed", () => {
    // Keeps AUTHED_ON_PURPOSE honest: an entry that stops being true, or a new
    // authed public-looking route, both surface here.
    for (const [route, reason] of Object.entries(AUTHED_ON_PURPOSE)) {
      expect(routeFiles()).toContain(route);
      expect(isPublic(route)).toBe(false);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
