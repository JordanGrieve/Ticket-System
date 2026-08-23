import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Settings → Access log: the client's own view of impersonation_sessions.
 *
 * Two things about this page can regress silently, and both matter more than
 * how it looks:
 *
 *  1. TENANCY. It must read the workspace from resolveViewer and nowhere else.
 *     An id taken from a route param or a search param would let any client
 *     read any other client's operator-access history — the one table where
 *     "who looked at whose customers" lives.
 *  2. HONESTY. `ended_at` null means we never observed the session end. The
 *     page must not turn that into an end time, and must not call it "still
 *     active"; a null `reason` must be shown as none given, not softened.
 *
 * These are static assertions over the source, in the style of
 * tests/impersonation-invariants.test.ts and for the same reason: rendering
 * this page for real needs Clerk, cookies and a database, and every suite in
 * this repo runs without DATABASE_URL. A blunt test that runs in CI beats a
 * precise one that never does.
 */

const PAGE = join(
  process.cwd(),
  "app",
  "(dashboard)",
  "settings",
  "access-log",
  "page.tsx",
);
const src = readFileSync(PAGE, "utf8");

/**
 * The page with its comments removed.
 *
 * Every negative assertion below runs against THIS, not the raw source. The
 * page documents the mistakes it is avoiding — it says in prose that it must
 * not print "still active" and must not show adminClerkUserId — and a naive
 * `not.toContain` over the whole file fails on the explanation rather than on
 * the code. Deleting those comments to make a test pass would be exactly the
 * wrong repair.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("access log — tenancy", () => {
  it("takes the workspace from resolveViewer, and redirects when there is none", () => {
    expect(src).toContain("const viewer = await resolveViewer()");
    expect(src).toMatch(/if \(!viewer\.workspace\) redirect\(/);
  });

  it("queries by that workspace's id and nothing else", () => {
    expect(src).toMatch(
      /listImpersonationSessionsForWorkspace\(\s*workspace\.id,/,
    );
  });

  it("accepts no params or searchParams at all", () => {
    // The strongest form of "never from a URL parameter": there is nothing to
    // read one out of. If this page ever needs paging, the id still may not
    // come from the URL — derive it from the viewer and page on an offset.
    expect(code).not.toMatch(/\bsearchParams\b/);
    expect(code).not.toMatch(/\bparams\b/);
    expect(src).toMatch(/export default async function \w+\(\)/);
  });

  it("does not reach for the platform-wide log", () => {
    // listImpersonationSessions() (no suffix) returns every workspace's rows.
    expect(code).not.toMatch(/listImpersonationSessions\s*\(/);
  });
});

describe("access log — says what was observed, not what was inferred", () => {
  it("classifies rows with sessionStates against one clock", () => {
    expect(src).toContain("sessionStates(sessions)");
    // Reading the clock per row would let a long list come out with two rows
    // either side of the abandoned threshold.
    expect(code).not.toMatch(/sessionState\(/);
  });

  it("never renders an unclosed session as active or ended", () => {
    // "Still active" is the specific lie this page exists not to tell: an open
    // row means nobody saw it end, which is not the same as it continuing.
    expect(code.toLowerCase()).not.toContain("still active");
    expect(src).toContain("Never observed to end");
  });

  it("only formats endedAt after narrowing it away from null", () => {
    // A non-null assertion here would print an "Invalid Date" or, worse, some
    // fallback that reads like a real exit time.
    expect(code).not.toMatch(/endedAt!/);
    expect(src).toMatch(/endedAt !== null \?/);
  });

  it("labels the unobserved duration as a floor, tied to lastSeenAt", () => {
    expect(src).toContain("at least");
    expect(src).toMatch(
      /formatDuration\(session\.startedAt, session\.lastSeenAt\)/,
    );
    expect(src).toContain("never seen to leave");
  });

  it("shows a missing reason as given-none, and invents nothing", () => {
    expect(src).toMatch(/session\.reason \?\?/);
    expect(src).toContain("None given");
  });

  it("distinguishes an empty log from an empty table", () => {
    expect(src).toMatch(/sessions\.length === 0 \?/);
    expect(src).toContain("No one from Postbox has entered this workspace.");
    // …and admits what the log cannot speak for.
    expect(src).toMatch(/before this log was switched on/);
  });
});

describe("access log — reachable, and the same data as the operator console", () => {
  it("is listed in the settings tab strip", () => {
    const tabs = readFileSync(
      join(process.cwd(), "app", "(dashboard)", "settings", "SettingsTabs.tsx"),
      "utf8",
    );
    // A settings surface nobody can navigate to is the newsletter-signup
    // failure again: shipped, tested, and unreachable.
    expect(tabs).toContain('href: "/settings/access-log"');
  });

  it("shares the operator console's formatters rather than copying them", () => {
    // The client must be able to quote a timestamp back at us and have it
    // match what we see in app/(admin). Two copies drift.
    expect(src).toMatch(
      /import \{ formatDateTime, formatDuration \} from "@\/app\/\(admin\)\/admin\/ui"/,
    );
  });

  it("shows the operator's email, and not their internal auth id", () => {
    // The decision, pinned so it is changed on purpose and not by accident:
    // the client can see WHICH operator entered (see OperatorLine's comment),
    // but adminClerkUserId identifies a person in a system they cannot reach
    // and is not theirs to receive.
    expect(src).toContain("session.adminEmail");
    expect(code).not.toContain("adminClerkUserId");
  });
});

describe("access log — every colour is a token", () => {
  it("the stylesheet's access-log block has no literal colours", () => {
    const css = readFileSync(join(process.cwd(), "app", "settings.css"), "utf8");
    const start = css.indexOf("/* ── Access log ──");
    expect(start, "the access-log CSS block has moved or gone").toBeGreaterThan(0);
    const block = css.slice(start);
    // Six themes ride on the custom properties; one hex is one broken theme.
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
});
