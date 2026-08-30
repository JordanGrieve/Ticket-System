import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeAdminAction,
  isDestructiveAdminAction,
} from "../lib/admin-audit";
import type { AdminActionKind } from "../db/schema";

/**
 * The operator action log.
 *
 * ── THE GAP THIS FILLS ──
 * impersonation_sessions records an operator ENTERING a client's workspace.
 * Nothing recorded what they did to the platform itself — and
 * deleteClientAction cascades away every ticket, message, label and subscriber
 * a client had. Before this, that could happen with no record of who did it,
 * when, or that it had happened at all.
 *
 * Mostly source-reading guards: the behaviour is a write inside a server
 * action and CI has no DATABASE_URL. What they protect is the two properties
 * that are easy to undo by accident — that the log is written BEFORE the
 * mutation, and that it has no foreign key to the thing it outlives.
 */

const SCHEMA = readFileSync(join(process.cwd(), "db/schema.ts"), "utf8");
const ACTIONS = readFileSync(
  join(process.cwd(), "app/(admin)/admin/actions.ts"),
  "utf8",
);
const LIB = readFileSync(join(process.cwd(), "lib/admin-audit.ts"), "utf8");

const ALL: AdminActionKind[] = [
  "workspace_created",
  "workspace_deleted",
  "admin_granted",
  "admin_revoked",
];

describe("the log survives what it describes", () => {
  it("has no foreign key to workspaces", () => {
    /*
     * The single most important property here. A references() with the cascade
     * this schema uses everywhere else would mean deleting a workspace also
     * deleted the record OF that deletion — an audit log that erases exactly
     * the entry somebody would come looking for.
     */
    const at = SCHEMA.indexOf("export const adminActions");
    expect(at).toBeGreaterThan(-1);
    const block = SCHEMA.slice(at, SCHEMA.indexOf("\n);", at));
    expect(block).not.toContain("references(");
    expect(block).not.toContain("workspaceId");
  });

  it("keeps a snapshot of the target rather than only an id", () => {
    // After the delete there is no row left to join to, so the name has to
    // have been copied at write time or it is gone.
    const at = SCHEMA.indexOf("export const adminActions");
    const block = SCHEMA.slice(at, SCHEMA.indexOf("\n);", at));
    expect(block).toContain("targetLabel");
  });

  it("does not lose an operator's history when their admin row goes", () => {
    // actorAdminId is nullable and actorEmail is frozen text, so revoking
    // somebody cannot quietly empty the record of what they did.
    const at = SCHEMA.indexOf("export const adminActions");
    const block = SCHEMA.slice(at, SCHEMA.indexOf("\n);", at));
    expect(block).toMatch(/actorAdminId: integer\("actor_admin_id"\)/);
    const actorLine = block.slice(block.indexOf("actorAdminId"));
    expect(actorLine.slice(0, actorLine.indexOf("\n"))).not.toContain(
      "notNull",
    );
    expect(block).toMatch(/actorEmail: text\("actor_email"\)\.notNull\(\)/);
  });
});

describe("every one of the four actions is recorded", () => {
  for (const action of ALL) {
    it(action, () => {
      expect(ACTIONS).toContain(`action: "${action}"`);
    });
  }

  it("records the deletion BEFORE deleteWorkspace runs", () => {
    /*
     * Order is the whole design. Recording afterwards would lose exactly the
     * case that matters most — the one where something went wrong midway — and
     * by then there is no workspace row left to name.
     */
    const recordAt = ACTIONS.indexOf('action: "workspace_deleted"');
    const deleteAt = ACTIONS.indexOf("await deleteWorkspace(id)");
    expect(recordAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(deleteAt);
  });

  it("records the revocation BEFORE removeAdmin runs", () => {
    const recordAt = ACTIONS.indexOf('action: "admin_revoked"');
    const removeAt = ACTIONS.indexOf("await removeAdmin(id)");
    expect(recordAt).toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(removeAt);
  });

  it("names a specific operator id, not just a session email", () => {
    // requireAdminRow rather than requireAdmin: an audit row that only carries
    // whatever address was on the session cannot survive a rename.
    for (const fn of [
      "createClientAction",
      "deleteClientAction",
      "addAdminAction",
      "removeAdminAction",
    ]) {
      const at = ACTIONS.indexOf(`export async function ${fn}`);
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      const body = ACTIONS.slice(at, at + 400);
      expect(body, `${fn} does not take the admin row`).toContain(
        "requireAdminRow()",
      );
    }
  });
});

describe("writing is fail-closed, unlike the other two logs", () => {
  it("does not swallow its own write errors", () => {
    /*
     * lib/ingestion-log.ts and lib/feedback-log.ts both catch and continue,
     * because they run on the failure path of a PUBLIC endpoint. This one runs
     * immediately before an irreversible mutation performed by a signed-in
     * operator, so a throw must stop the action. An operator retrying is a mild
     * annoyance; an unrecorded deletion is permanent.
     */
    const at = LIB.indexOf("export async function recordAdminAction");
    const body = LIB.slice(at, LIB.indexOf("export type AdminActionRow"));
    expect(body).not.toContain("catch");
  });

  it("still fails soft on READS", () => {
    // Nothing depends on the read; an empty list beats a 500 on the console.
    const at = LIB.indexOf("export async function recentAdminActions");
    const body = LIB.slice(at, LIB.indexOf("export function describeAdminAction"));
    expect(body).toContain("catch");
    expect(body).toContain("return [];");
  });
});

describe("what an operator reads", () => {
  it("describes every action", () => {
    for (const a of ALL) expect(describeAdminAction(a).length).toBeGreaterThan(5);
  });

  it("marks exactly the two destructive ones", () => {
    const destructive = ALL.filter(isDestructiveAdminAction);
    expect(destructive).toEqual(["workspace_deleted", "admin_revoked"]);
  });
});
