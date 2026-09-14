import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
/**
 * Every file that writes to the admin log, DISCOVERED rather than listed.
 *
 * This was one hardcoded path — the console's actions.ts — which is only one of
 * the places that records. "workspace_exported" is written by the export route,
 * so the check below could never have seen it, and said so the moment the kind
 * list stopped being maintained by hand. Same failure as the token guard that
 * scanned nine stylesheets out of twenty (AGENTS.md): a guard is only as wide
 * as its input, and a narrow one reports clean about the part it cannot see.
 */
function writersOfTheLog(): string {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(path);
      } else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        if (text.includes("recordAdminAction(")) found.push(text);
      }
    }
  };

  walk(join(process.cwd(), "app"));
  walk(join(process.cwd(), "lib"));

  // The discovery has to have found something, or every assertion built on it
  // passes by looking at nothing.
  if (found.length < 2) {
    throw new Error(
      `Expected several writers of the admin log, found ${found.length}`,
    );
  }
  return found.join("\n");
}

const ACTIONS = writersOfTheLog();
const LIB = readFileSync(join(process.cwd(), "lib/admin-audit.ts"), "utf8");

/*
  Every action kind, kept exhaustive BY THE COMPILER.

  It was a hand-written array and it had already gone stale: "workspace_exported"
  was added to the vocabulary and never added here, so the checks below — is it
  recorded anywhere, does it have a description, is it marked destructive — had
  quietly stopped covering it. A list of everything that is maintained by hand
  is a list that is eventually wrong about everything added since.

  `satisfies Record<AdminActionKind, true>` makes a missing key a type error, so
  the next kind cannot be added without landing here.
*/
const EVERY_KIND = {
  workspace_created: true,
  workspace_deleted: true,
  admin_granted: true,
  admin_revoked: true,
  workspace_exported: true,
  workspace_key_rotated: true,
} satisfies Record<AdminActionKind, true>;

const ALL = Object.keys(EVERY_KIND) as AdminActionKind[];

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

describe("every action kind is recorded somewhere", () => {
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
      "rotateKeyAction",
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

/**
 * Replacing a client's ingestion key is ours to do, not theirs.
 *
 * ── WHY IT MOVED ──
 * It was a button on the client's own Install page: no role check, so every
 * team member they invite could press it; one click, irreversible; and what it
 * breaks is their live contact form, which goes on posting to a key that no
 * longer exists until somebody edits their website. The ingestion route calls
 * that "THE bakery case" and records that it ran for six weeks unnoticed.
 *
 * The key it protects authorises POSTing a ticket or a signup and can read
 * nothing, and it ships in the client's page source by design — so the thing
 * being guarded is spam, and the guard cost them their enquiries.
 *
 * Jordan, 14 Sep 2026: "this should be our call, no? not theirs."
 */
describe("only an operator can replace a client's ingestion key", () => {
  const INSTALL = readFileSync(
    join(process.cwd(), "components/InstallView.tsx"),
    "utf8",
  );

  it("the client's page offers no way to do it", () => {
    /*
     * Comments stripped first, and that is not a loophole — it is the
     * difference between the page OFFERING rotation and the file EXPLAINING
     * why it no longer does. The first version of this failed on the note left
     * behind for the next reader, which would have taught somebody to delete
     * the explanation to get the suite green. Same mistake this repo has made
     * before, asserting against prose in a comment.
     */
    const code = INSTALL.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /\/\/[^\n]*/g,
      "",
    );
    expect(code.toLowerCase()).not.toContain("rotate");
  });

  it("and no endpoint a client's session could POST to", () => {
    /*
     * The button going while the route stayed would be the worse half-fix: the
     * control is invisible and the capability is intact, reachable by anyone
     * who opens a console and types fetch. The old route checked signed-in and
     * had-a-workspace, nothing more.
     */
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name === "route.ts") routes.push(path);
      }
    };
    walk(join(process.cwd(), "app/api"));

    expect(routes.length, "no API routes found — this check is blind").
      toBeGreaterThan(5);
    expect(routes.filter((r) => /rotate/i.test(r))).toEqual([]);
  });

  it("is gated by typing the workspace name, like the delete", () => {
    // It looks milder than a deletion and is not: a delete lands on a client
    // who asked for it, this lands on one who is not in the room.
    const at = ACTIONS.indexOf("export async function rotateKeyAction");
    expect(at).toBeGreaterThan(-1);
    const body = ACTIONS.slice(at, ACTIONS.indexOf("\n}", at));

    /*
     * The COMPARISON, not the word.
     *
     * The first version of this asserted that "confirmName" appeared before
     * "rotateWorkspaceApiKey" and passed happily with the guard replaced by
     * `if (false)` — the name was still read into a const two lines up, so the
     * string was still there in the right order while nothing was checked.
     * Breaking the guard and watching the test not notice is the only reason
     * that was found.
     */
    const guard = body.indexOf("confirmName !== workspace.name");
    const mutation = body.indexOf("rotateWorkspaceApiKey");
    expect(guard, "nothing compares the typed name to the workspace's").
      toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(-1);
    expect(guard, "the name is checked after the key has already changed").
      toBeLessThan(mutation);

    // And the mismatch has to actually stop it.
    expect(body.slice(guard, mutation)).toContain("redirect(");
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

  it("marks exactly the destructive ones", () => {
    /*
     * Key rotation joined these on 14 Sep 2026. Nothing is deleted by it, which
     * is why it is worth stating: the old key stops working immediately and
     * every form on the client's website fails from that moment, silently, at
     * their end. In the list an operator scans for "what did we do to this
     * client", that belongs with the deletions.
     */
    const destructive = ALL.filter(isDestructiveAdminAction);
    expect(destructive.sort()).toEqual(
      ["admin_revoked", "workspace_deleted", "workspace_key_rotated"].sort(),
    );
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
