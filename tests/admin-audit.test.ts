import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeAdminAction,
  isDestructiveAdminAction,
} from "../lib/admin-audit";
import type { AdminActionKind } from "../db/schema";
import {
  ADMIN_ACTION_CHAIN_DOMAIN,
  ADMIN_CHAINED_FIELDS,
  adminActionGenesisHash,
  adminActionRowHash,
  verifyAdminActionChain,
} from "../lib/admin-actions-chain";

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
     * operator, so a failure must stop the action. An operator retrying is a
     * mild annoyance; an unrecorded deletion is permanent.
     *
     * ── THIS ASSERTION USED TO BE `not.toContain("catch")` ──
     * Which was a proxy for the property, not the property. When the hash
     * chain arrived the append grew a legitimate catch — it retries a lost
     * race for the head of the chain — and the test failed for a reason that
     * had nothing to do with fail-closed behaviour.
     *
     * So it now asserts the two things that actually make it fail-closed: any
     * error that is not the retryable one is rethrown, and running out of
     * retries throws rather than returning quietly.
     */
    const at = LIB.indexOf("export async function recordAdminAction");
    const body = LIB.slice(at, LIB.indexOf("function chainSecret"));

    // Anything that is not a lost race reaches the caller untouched.
    expect(body).toMatch(/if \(!isUniqueViolation\(err\)\) throw err;/);
    // And exhausting the retries is a throw, not a silent return.
    expect(body).toMatch(/throw new Error\(/);
    // No bare swallow anywhere in it.
    expect(body).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
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

/**
 * The chain over admin_actions.
 *
 * Real behavioural tests, not source reading: lib/admin-actions-chain.ts is
 * pure so a log can be built, tampered with the way somebody actually would,
 * and checked. Mirrors tests/impersonation-chain.test.ts, because the two
 * chains now share lib/hash-chain.ts and a bug in the shared walk should fail
 * in both places rather than one.
 */
describe("the admin action chain", () => {
  function content(n: number) {
    return {
      action: (n % 2 === 0 ? "workspace_deleted" : "workspace_created") as AdminActionKind,
      actorAdminId: 1,
      actorEmail: "jordan@postbox.help",
      targetId: 100 + n,
      targetLabel: `Client ${n}`,
      detail: n % 3 === 0 ? null : `note ${n}`,
      createdAt: new Date(Date.UTC(2026, 7, 30, 13, n, 0)),
    };
  }

  function buildChain(count: number, secret: string | null = null) {
    const rows = [];
    let prev = adminActionGenesisHash(secret);
    for (let i = 0; i < count; i++) {
      const c = content(i);
      const hash = adminActionRowHash(c, prev, secret);
      rows.push({ id: i + 1, ...c, chainPrevHash: prev, chainHash: hash });
      prev = hash;
    }
    return rows;
  }

  it("verifies a chain nobody has touched", () => {
    const v = verifyAdminActionChain(buildChain(5));
    expect(v.ok).toBe(true);
    expect(v.verified).toBe(5);
  });

  it("catches a deletion — the thing this table exists to record", () => {
    /*
     * The scenario in full: an operator deletes a client workspace, then
     * deletes the row saying they did. Before the chain that was invisible.
     */
    const rows = buildChain(5);
    const kept = [...rows.slice(0, 2), ...rows.slice(3)];
    const v = verifyAdminActionChain(kept);
    expect(v.ok).toBe(false);
    expect(v.firstBreak?.kind).toBe("row_removed");
    expect(v.firstBreak?.detail).toContain("Action #");
  });

  it("catches an edit to who did it", () => {
    const rows = buildChain(4);
    rows[2] = { ...rows[2], actorEmail: "someone-else@postbox.help" };
    const v = verifyAdminActionChain(rows);
    expect(v.firstBreak?.kind).toBe("row_modified");
    expect(v.firstBreak?.index).toBe(2);
  });

  it("catches deletion of the oldest row, which has no successor to notice", () => {
    const rows = buildChain(4);
    const v = verifyAdminActionChain(rows.slice(1));
    expect(v.firstBreak?.kind).toBe("chain_head_removed");
  });

  it("is keyed independently of the impersonation chain", () => {
    // Different domain tags, so a row lifted from one table cannot be made to
    // verify against the other's chain.
    expect(ADMIN_ACTION_CHAIN_DOMAIN).not.toBe("postbox.impersonation-chain.v1");
    const withSecret = verifyAdminActionChain(buildChain(3, "s3cret"), "s3cret");
    expect(withSecret.ok).toBe(true);
    expect(withSecret.keyed).toBe(true);
    // The same rows against the wrong key must NOT verify.
    expect(verifyAdminActionChain(buildChain(3, "s3cret"), null).ok).toBe(false);
  });

  it("covers every column, because nothing here is written after the insert", () => {
    /*
     * The difference from the impersonation chain, and worth pinning: that one
     * has a mutable tail (lastSeenAt, endedAt, endedReason) it cannot cover.
     * admin_actions rows are written once and never updated, so a field left
     * out of the hash would be a silent gap rather than a documented one.
     */
    const base = content(1);
    const prev = adminActionGenesisHash(null);
    const baseline = adminActionRowHash(base, prev, null);
    const altered: Record<string, unknown> = {
      action: "admin_revoked",
      actorAdminId: 999,
      actorEmail: "other@postbox.help",
      targetId: 4242,
      targetLabel: "Someone Else",
      detail: "different",
      createdAt: new Date(Date.UTC(2027, 0, 1)),
    };
    for (const field of ADMIN_CHAINED_FIELDS) {
      const mutated = { ...base, [field]: altered[field] };
      expect(
        adminActionRowHash(mutated as typeof base, prev, null),
        `changing ${field} did not change the hash`,
      ).not.toBe(baseline);
    }
  });
});
