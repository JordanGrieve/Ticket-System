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

    /*
      BOUNDED AT THE NEXT SECTION BANNER, not at the end of the file.

      The first version of this sliced to EOF, so it policed every rule written
      after the access-log block rather than the block itself. That went
      unnoticed while it passed, and the moment this test came back it failed
      on `.stg-brand-sample` — which paints on a literal white deliberately,
      because white is the ground the EMAIL uses, and has a comment saying so.

      An over-broad guard is not a strict guard. It fails on correct code
      somewhere else, and the pressure is then to weaken the rule or to "fix"
      the innocent bystander. Both are worse than the narrow check.
    */
    const rest = css.slice(start + 1);
    const nextBanner = rest.search(/\/\* ── /);
    expect(nextBanner, "no section follows the access-log block — the bound " +
      "would silently become end-of-file again").toBeGreaterThan(0);
    const block = css.slice(start, start + 1 + nextBanner);

    // Guard the guard: a bound that captured nothing would pass every
    // assertion below without reading a single declaration.
    expect(block).toContain(".stg-al-");
    // Six themes ride on the custom properties; one hex is one broken theme.
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
});

describe("access log — the conversations opened during a visit", () => {
  /*
   * The page was taken off Settings on 28 August and put back on the 30th, and
   * in between it gained something it could not say before: which tickets an
   * operator opened. Restoring the old file verbatim would have shipped a
   * paragraph that was true when written and false by the time it came back —
   * it told the client "Postbox does not log access to individual records
   * anywhere". These pin the corrected version.
   */
  it("no longer claims that per-record access is unlogged", () => {
    expect(code).not.toMatch(/does not log access to individual records/i);
  });

  it("renders the recorded reads rather than only the visit", () => {
    expect(code).toContain("readsForSessions");
    expect(code).toContain("r.ticketId");
  });

  it("fetches the reads in ONE query for the whole page", () => {
    /*
     * neon-http gives every statement its own HTTP request, and this page
     * lists up to LIMIT visits. A per-visit lookup would be up to 200 round
     * trips on a settings page — so the call must sit at the top level, not
     * inside the map that renders each visit.
     */
    const call = code.indexOf("readsForSessions(");
    const map = code.indexOf("sessions.map(");
    expect(call).toBeGreaterThan(-1);
    expect(map).toBeGreaterThan(-1);
    expect(call).toBeLessThan(map);
  });

  it("says an empty list is unrecorded, never that nothing was read", () => {
    /*
     * THE PROPERTY THAT MATTERS MOST ON THIS PAGE.
     *
     * The write is best effort by design — it is allowed to fail rather than
     * break a page an operator is working in — so an empty list does not mean
     * no conversation was opened. This page exists to be trusted; printing
     * "None" would make it assert something it does not know, and a client
     * could reasonably rely on that in a dispute.
     */
    expect(code).toContain("None recorded");
    expect(code).not.toMatch(/>\s*None\s*</);
  });

  it("tells the reader the list is a floor, not an inventory", () => {
    // The caveat has to be on the page in the client's words, not only in a
    // comment addressed to whoever edits it next.
    expect(src).toMatch(/floor, not an inventory/i);
  });

  it("does not print message subjects or customer details", () => {
    // Ticket numbers only. The client can follow the link into their own
    // inbox; copying the customer's words into an audit page would put the
    // same personal data in a second place for no added answer.
    const start = code.indexOf("Conversations opened");
    expect(start).toBeGreaterThan(-1);
    const block = code.slice(start, start + 1200);
    expect(block).not.toMatch(/subject|customerName|customerEmail/);
  });
});
