import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeAdminAction } from "../lib/admin-audit";

/**
 * Logging the one endpoint that hands over a whole workspace.
 *
 * GET /api/workspace/export returns every ticket, message and contact a
 * workspace owns, in one file. Until this, an operator could pull all of it
 * and the client's access log would show a visit with no conversations
 * opened — true, and giving entirely the wrong impression of what happened.
 *
 * Static assertions over the source, the same technique and for the same
 * reason as tests/impersonation-invariants.test.ts: exercising this for real
 * needs Clerk, cookies and a database, and every suite here runs without
 * DATABASE_URL.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const route = read("app", "api", "workspace", "export", "route.ts");
const page = read(
  "app",
  "(dashboard)",
  "settings",
  "access-log",
  "page.tsx",
);
const policy = read("app", "(legal)", "privacy", "page.tsx");

/** The route with comments stripped, so prose cannot satisfy an assertion. */
const code = route
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("exporting a workspace is recorded", () => {
  it("the export route records the action", () => {
    expect(code).toContain("recordAdminAction");
    expect(code).toContain("workspace_exported");
  });

  it("records BEFORE reading the data", () => {
    /*
     * Same ordering rule lib/admin-audit.ts applies to deletion: an export
     * that dies halfway has still moved data into somebody's memory, so the
     * log should say it was attempted rather than only that it finished.
     */
    // The CALL, not the import line — which sits above everything and would
    // make this pass whatever the body did.
    expect(code.indexOf("recordAdminAction({")).toBeGreaterThan(-1);
    expect(code.indexOf("recordAdminAction({")).toBeLessThan(
      code.indexOf("exportWorkspaceData("),
    );
  });

  it("is FAIL-CLOSED — a failure to log means no export", () => {
    /*
     * The opposite choice to impersonation_reads, and the difference is the
     * point. That one is best effort because refusing to render a ticket would
     * break the product mid-investigation over a decorative row. This is a
     * bulk extraction of a client's customer data: if it cannot be recorded,
     * it must not happen. The cost of being wrong is one failed download.
     *
     * Asserted as the PROPERTY — the catch returns a response instead of
     * falling through — rather than by looking for the word "catch", which an
     * unrelated retry would satisfy.
     */
    const start = code.indexOf("recordAdminAction({");
    const block = code.slice(start, code.indexOf("exportWorkspaceData("));
    expect(block).toMatch(/catch/);
    expect(block).toMatch(/return json\(/);
    expect(block).toContain("503");
  });

  it("only fires for a Postbox operator, never a client exporting their own data", () => {
    // A client downloading their own records is portability, not access by us.
    // Logging it under "operator actions" would be simply wrong.
    const call = code.indexOf("recordAdminAction({");
    const guard = code.lastIndexOf("currentImpersonation()", call);
    expect(guard).toBeGreaterThan(-1);
    expect(call - guard).toBeLessThan(200);
  });
});

describe("the client can see the copies that were taken", () => {
  it("the access log queries its own workspace's exports", () => {
    expect(page).toContain("exportsForWorkspace(workspace.id)");
  });

  it("renders them as their own section, not buried inside a visit", () => {
    // An export is a different kind of event from a screen being looked at.
    // Folding it into a visit line would understate it.
    expect(page).toContain("Copies taken of all your data");
  });

  it("names the action in the client's terms, not ours", () => {
    // "Exported data" understates it. The noun that matters is what left.
    expect(describeAdminAction("workspace_exported")).toBe(
      "Downloaded all client data",
    );
  });
});

describe("the privacy policy keeps up with what is logged", () => {
  /*
   * This has now bitten twice — restoring the access-log page brought back a
   * paragraph claiming per-record access was unlogged, which had stopped being
   * true. The policy has to move whenever the logging does.
   */
  it("no longer says copies are outside what the log covers", () => {
    expect(policy).toContain("full copy");
  });

  it("still states plainly what remains uncovered", () => {
    expect(policy).toMatch(/does not cover data reached other than/i);
    expect(policy).toMatch(/directly against the database/i);
  });
});
