import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the per-record access log: what an operator opened inside a client's
 * workspace, recorded so the client can be told.
 *
 * Static source assertions, same reason as tests/impersonation-invariants:
 * every test here runs with no DATABASE_URL, and a blunt test that runs in CI
 * beats a precise one that never does.
 *
 * Three properties, and they pull in opposite directions, which is the whole
 * reason to pin them:
 *
 *  1. It must not be able to break the page. The write is best effort, unlike
 *     the session row it hangs off.
 *  2. It must only fire for POSTBOX OPERATORS. Logging a client's own staff
 *     reading their own inbox is surveillance of a client's employees, which
 *     nobody has asked for and which db/schema.ts records as undecided.
 *  3. It must not copy customer content into our console.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const lib = read("lib", "impersonation-reads.ts");
const thread = read(
  "app",
  "(dashboard)",
  "tickets",
  "[id]",
  "@thread",
  "page.tsx",
);
const sections = read("app", "(admin)", "admin", "sections.tsx");

describe("impersonation reads — best effort, never fatal", () => {
  it("every exported query is wrapped so a failure cannot reach the caller", () => {
    /*
      Asserts the PROPERTY, not the token.

      An earlier guard in this repo asserted the absence of the word "catch" as
      a proxy for "fail-closed", and broke the day the code it watched gained a
      legitimate retry. So this counts instead: each exported async function
      here must contain a try and a catch, because each one is called from a
      render path where throwing would blank a page.
    */
    const fns = lib.match(/export async function \w+/g) ?? [];
    expect(fns.length, "no exported queries found — has the module moved?")
      .toBeGreaterThan(0);

    for (const fn of fns) {
      const body = lib.slice(lib.indexOf(fn), lib.indexOf(fn) + 4000);
      const upToNextExport = body.split("\nexport ")[0];
      expect(
        /try\s*\{/.test(upToNextExport) && /\}\s*catch/.test(upToNextExport),
        `${fn} is not wrapped in try/catch. A page must not fail because its ` +
          "access log did — see the module header.",
      ).toBe(true);
    }
  });

  it("recordImpersonationRead returns void, so no caller can await a result it must check", () => {
    expect(lib).toContain("): Promise<void>");
  });
});

describe("impersonation reads — operators only", () => {
  it("the ticket page records a read only inside an impersonation", () => {
    expect(
      thread.includes("recordImpersonationRead"),
      "the thread slot no longer records reads at all",
    ).toBe(true);

    /*
      The call must sit inside a check on currentImpersonation(). Anything
      unconditional would log a bakery's own staff opening their own tickets.
    */
    const call = thread.indexOf("recordImpersonationRead(");
    const before = thread.slice(0, call);
    const guard = before.lastIndexOf("currentImpersonation()");
    expect(
      guard,
      "recordImpersonationRead is not guarded by currentImpersonation(). " +
        "That would log a client's own staff reading their own inbox, which " +
        "is a decision nobody has taken — see db/schema.ts.",
    ).toBeGreaterThan(-1);
    // And close by: the guard has to be the enclosing condition, not something
    // that happens to appear anywhere earlier in the file.
    expect(call - guard).toBeLessThan(200);
  });

  it("records the read only after the ticket is known to exist", () => {
    // notFound() first: a request for a ticket in someone else's workspace is
    // not access to anything, and logging it would fill a client's access log
    // with records they never had.
    expect(thread.indexOf("if (!ticket) notFound();")).toBeGreaterThan(-1);
    expect(thread.indexOf("if (!ticket) notFound();")).toBeLessThan(
      thread.indexOf("recordImpersonationRead("),
    );
  });
});

describe("impersonation reads — ids, not content", () => {
  it("stores nothing but the ticket id", () => {
    // The insert names exactly these columns. Adding a subject or a customer
    // email here would copy a client's customer data into our own audit table.
    const values = lib.slice(lib.indexOf(".values({"), lib.indexOf(".values({") + 80);
    expect(values).toContain("sessionId");
    expect(values).toContain("ticketId");
    expect(values).not.toMatch(/subject|customer|body|email/i);
  });

  it("the console renders numbers, not message text", () => {
    const start = sections.indexOf("function ReadList");
    expect(start, "ReadList not found — has the column been renamed?")
      .toBeGreaterThan(-1);
    const body = sections.slice(start, sections.indexOf("export function AccessSection"));
    expect(body).toContain("r.ticketId");
    expect(body).not.toMatch(/subject|customerName|customerEmail/);
  });

  it("the console says an empty cell means unrecorded, not unread", () => {
    // The honest claim. A best-effort log that presents itself as complete is
    // worse than no log, because a client would rely on it.
    expect(sections).toContain("nothing was recorded");
  });
});
