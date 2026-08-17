import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the rule that operator access into a client workspace is granted by an
 * open audit row, never by a cookie alone.
 *
 * The bug this exists to prevent was real and shipped: selectedAdminWorkspace
 * returned `{ workspace, impersonation: null }` when the session cookie was
 * missing or mismatched, so setting `pb_admin_ws` by hand in devtools was
 * enough to enter a tenant with nothing written to impersonation_sessions —
 * and GET /api/workspace/export would then hand back that tenant's entire
 * tickets, messages and contacts as JSON, unlogged.
 *
 * These are static assertions over the source. That is a blunt instrument, but
 * the alternative needs Clerk, cookies and a database, and this repo has no
 * mocking layer — every other test here runs without DATABASE_URL and this one
 * keeps that property. A blunt test that runs in CI beats a precise one that
 * never does.
 */

const viewerSrc = readFileSync(
  join(process.cwd(), "lib", "viewer.ts"),
  "utf8",
);

/** The body of selectedAdminWorkspace, which is where the rule has to hold. */
function selectedAdminWorkspaceBody(): string {
  const start = viewerSrc.indexOf("async function selectedAdminWorkspace");
  expect(start, "selectedAdminWorkspace not found — has it been renamed?").
    toBeGreaterThan(-1);
  // Up to the next top-level declaration.
  const rest = viewerSrc.slice(start);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("impersonation — access requires an audit row", () => {
  it("never returns a workspace alongside a null session", () => {
    const body = selectedAdminWorkspaceBody();

    // Any early return that yields a workspace but no session is the bug.
    // Matches `{ workspace, impersonation: null }` and the spelled-out
    // `{ workspace: workspace, impersonation: null }`.
    const leak =
      /return\s*\{\s*workspace(\s*:\s*workspace)?\s*,\s*impersonation\s*:\s*null\s*\}/;

    expect(
      leak.test(body),
      "selectedAdminWorkspace returns a workspace with no impersonation " +
        "session. That grants unlogged access to a tenant's data — access " +
        "must be granted by an open audit row, not by the pb_admin_ws cookie.",
    ).toBe(false);
  });

  it("only ever returns a workspace together with a touched session", () => {
    const body = selectedAdminWorkspaceBody();

    // The single success path must heartbeat before handing back access, so an
    // operator cannot read a client's data without moving lastSeenAt.
    expect(body).toContain("touchImpersonation");

    const successReturns = body.match(/return\s*\{\s*workspace\s*,/g) ?? [];
    expect(
      successReturns.length,
      "expected exactly one return that yields a workspace",
    ).toBe(1);
  });

  it("verifies the session belongs to this admin and this workspace", () => {
    const body = selectedAdminWorkspaceBody();
    // Without both checks, one operator's open session would authorise another
    // operator, or authorise a different workspace than the one it names.
    expect(body).toContain("session.adminId !== adminId");
    expect(body).toContain("session.workspaceId !== workspace.id");
  });
});

describe("impersonation — cookies", () => {
  const actionsSrc = readFileSync(
    join(process.cwd(), "app", "(admin)", "admin", "actions.ts"),
    "utf8",
  );

  it("are httpOnly and secure outside development", () => {
    const start = actionsSrc.indexOf("IMP_COOKIE_OPTS");
    const opts = actionsSrc.slice(start, start + 400);
    expect(opts).toContain("httpOnly: true");
    expect(opts).toContain("secure:");
  });
});
