import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAINED_FIELDS,
  UNCHAINED_COLUMNS,
  describeChainVerification,
  impersonationGenesisHash,
  impersonationRowHash,
  verifyImpersonationChain,
  type ImpersonationChainRow,
} from "../lib/impersonation-chain";

/**
 * The hash chain over impersonation_sessions.
 *
 * These are real assertions about real behaviour, not static source reading:
 * lib/impersonation-chain.ts is pure by design precisely so this suite can
 * build a log, tamper with it the way somebody actually would, and check that
 * the tampering is reported at the right row with the right name. CI has no
 * DATABASE_URL and this file never asks for one.
 *
 * The last describe block is static, and only for the parts that cannot be
 * exercised without a database: that the writer really does hash every insert,
 * and that the uniques the chain depends on are in the schema.
 */

const ROOT = join(__dirname, "..");

/** A row's worth of entry facts, varied enough that order is visible. */
function content(n: number) {
  return {
    adminId: 1,
    adminEmail: "jordan@postbox.help",
    adminClerkUserId: "user_abc",
    workspaceId: 100 + n,
    workspaceName: `Client ${n}`,
    reason: n % 2 === 0 ? null : `looking at ticket ${n}`,
    startedAt: new Date(Date.UTC(2026, 7, 30, 12, n, 0)),
  };
}

/**
 * Build a valid chain of `count` rows, the way appendImpersonationRow does.
 * `legacy` rows are prepended with null hashes, standing in for the rows that
 * were already in the table before any of this shipped.
 */
function buildChain(
  count: number,
  { secret = null, legacy = 0 }: { secret?: string | null; legacy?: number } = {},
): ImpersonationChainRow[] {
  const rows: ImpersonationChainRow[] = [];
  let id = 1;

  for (let i = 0; i < legacy; i++) {
    rows.push({
      id: id++,
      ...content(i),
      chainPrevHash: null,
      chainHash: null,
    });
  }

  let prev = impersonationGenesisHash(secret);
  for (let i = 0; i < count; i++) {
    const c = content(legacy + i);
    const hash = impersonationRowHash(c, prev, secret);
    rows.push({ id: id++, ...c, chainPrevHash: prev, chainHash: hash });
    prev = hash;
  }
  return rows;
}

describe("a chain nobody has touched", () => {
  it("verifies, and says how many rows it verified", () => {
    const v = verifyImpersonationChain(buildChain(5));
    expect(v.ok).toBe(true);
    expect(v.firstBreak).toBeNull();
    expect(v.verified).toBe(5);
    expect(v.legacyUnverified).toBe(0);
    expect(v.total).toBe(5);
  });

  it("verifies whichever order the rows arrive in", () => {
    // The console lists sessions newest first; it must not have to remember
    // to re-sort before asking whether the log is intact.
    const newestFirst = [...buildChain(5)].reverse();
    expect(verifyImpersonationChain(newestFirst).ok).toBe(true);
  });

  it("verifies a single row against genesis", () => {
    // The genesis case is the one with no predecessor to compare against, so
    // it is the one an off-by-one in the walk gets wrong.
    const v = verifyImpersonationChain(buildChain(1));
    expect(v.ok).toBe(true);
    expect(v.verified).toBe(1);
  });

  it("verifies an empty log", () => {
    const v = verifyImpersonationChain([]);
    expect(v.ok).toBe(true);
    expect(v.total).toBe(0);
  });
});

describe("an edited row", () => {
  it("is reported as modified, at its own index", () => {
    const rows = buildChain(5);
    // The edit somebody would actually make: change which workspace they
    // were in, or blank the reason they gave.
    rows[2] = { ...rows[2], workspaceName: "Somebody Else Ltd" };

    const v = verifyImpersonationChain(rows);
    expect(v.ok).toBe(false);
    expect(v.firstBreak?.kind).toBe("row_modified");
    expect(v.firstBreak?.index).toBe(2);
    expect(v.firstBreak?.id).toBe(rows[2].id);
    // Rows before the break did verify, and are reported as such.
    expect(v.verified).toBe(2);
  });

  it("is caught when only the start time moved", () => {
    // A shortened visit is the subtlest useful edit, and the only field where
    // a millisecond matters.
    const rows = buildChain(3);
    rows[1] = {
      ...rows[1],
      startedAt: new Date(
        (rows[1].startedAt as Date).getTime() + 1,
      ),
    };
    const v = verifyImpersonationChain(rows);
    expect(v.firstBreak?.kind).toBe("row_modified");
    expect(v.firstBreak?.index).toBe(1);
  });

  it("is caught when the reason is emptied rather than changed", () => {
    // null and "" are different facts, and the encoding has to keep them so.
    const rows = buildChain(4);
    expect(rows[1].reason).not.toBeNull();
    rows[1] = { ...rows[1], reason: "" };
    expect(verifyImpersonationChain(rows).firstBreak?.kind).toBe("row_modified");
  });
});

describe("a deleted row", () => {
  it("is reported at its successor, as a removal rather than an edit", () => {
    const rows = buildChain(5);
    const kept = [...rows.slice(0, 2), ...rows.slice(3)];

    const v = verifyImpersonationChain(kept);
    expect(v.ok).toBe(false);
    // The row that WAS index 3 is now index 2, and it is the one pointing at
    // a hash that is no longer in the table.
    expect(v.firstBreak?.kind).toBe("row_removed");
    expect(v.firstBreak?.index).toBe(2);
    expect(v.firstBreak?.id).toBe(rows[3].id);
  });

  it("is distinguished from an edit even when several rows go at once", () => {
    const rows = buildChain(6);
    const kept = [...rows.slice(0, 1), ...rows.slice(4)];
    const v = verifyImpersonationChain(kept);
    expect(v.firstBreak?.kind).toBe("row_removed");
    expect(v.firstBreak?.id).toBe(rows[4].id);
  });

  it("is caught at the HEAD of the chain, which has no successor to notice", () => {
    // Without the genesis anchor this is the invisible deletion: the second
    // row simply becomes the first and nothing contradicts it.
    const rows = buildChain(4);
    const v = verifyImpersonationChain(rows.slice(1));
    expect(v.firstBreak?.kind).toBe("chain_head_removed");
    expect(v.firstBreak?.index).toBe(0);
    expect(v.verified).toBe(0);
  });

  /**
   * The honest blind spot, asserted so it cannot be forgotten or quietly
   * claimed away. Truncating the newest rows leaves a chain that is internally
   * perfect, because the only thing that would have pointed at them is a row
   * that is also gone. Fixing it requires an anchor kept OUTSIDE this table.
   */
  it("is NOT caught when the newest rows are truncated — documented limit", () => {
    const rows = buildChain(6);
    const v = verifyImpersonationChain(rows.slice(0, 3));
    expect(v.ok).toBe(true);
    expect(v.verified).toBe(3);
  });
});

describe("rows that predate the chain", () => {
  it("are counted as unverifiable, never as verified", () => {
    const rows = buildChain(3, { legacy: 4 });
    const v = verifyImpersonationChain(rows);
    expect(v.ok).toBe(true);
    expect(v.legacyUnverified).toBe(4);
    expect(v.verified).toBe(3);
    expect(v.total).toBe(7);
    // And the sentence a human reads must say so out loud.
    expect(describeChainVerification(v)).toContain("cannot be verified");
  });

  it("do not excuse a hashless row appearing after the chain started", () => {
    // The forgery this blocks: insert a row with null hashes and let it be
    // mistaken for history. Legacy rows are all OLDER than every chained row,
    // so a null-hash row with chained rows before it is not one.
    const rows = buildChain(4, { legacy: 2 });
    rows.push({
      id: 99,
      ...content(9),
      chainPrevHash: null,
      chainHash: null,
    });

    const v = verifyImpersonationChain(rows);
    expect(v.ok).toBe(false);
    expect(v.firstBreak?.kind).toBe("unchained_row");
    expect(v.firstBreak?.id).toBe(99);
  });

  it("still leave the first chained row anchored to genesis", () => {
    // Deleting the oldest CHAINED row is detectable even with legacy rows in
    // front of it, which is the whole reason the anchor exists rather than
    // "whatever the oldest hashed row happens to be".
    const rows = buildChain(3, { legacy: 2 });
    const kept = [...rows.slice(0, 2), ...rows.slice(3)];
    const v = verifyImpersonationChain(kept);
    expect(v.firstBreak?.kind).toBe("chain_head_removed");
    expect(v.legacyUnverified).toBe(2);
  });

  it("reports a half-cleared row as neither legacy nor chained", () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1], chainHash: null };
    const v = verifyImpersonationChain(rows);
    expect(v.firstBreak?.kind).toBe("partial_hash");
    expect(v.firstBreak?.index).toBe(1);
  });
});

describe("the secret", () => {
  it("changes every hash, so a chain cannot be checked without it", () => {
    const keyed = buildChain(3, { secret: "s3cret" });
    const unkeyed = buildChain(3);
    expect(keyed[0].chainHash).not.toBe(unkeyed[0].chainHash);

    expect(verifyImpersonationChain(keyed, "s3cret").ok).toBe(true);
    expect(verifyImpersonationChain(keyed, null).ok).toBe(false);
    expect(verifyImpersonationChain(keyed, "wrong").ok).toBe(false);
  });

  it("makes a forged row unforgeable without it", () => {
    // The point of keying, stated as a test: an attacker who knows the
    // algorithm but not the secret cannot re-seal a row they edited.
    const rows = buildChain(3, { secret: "s3cret" });
    const forged = { ...rows[1], workspaceName: "Somebody Else Ltd" };
    forged.chainHash = impersonationRowHash(forged, forged.chainPrevHash!, null);
    rows[1] = forged;
    expect(verifyImpersonationChain(rows, "s3cret").firstBreak?.kind).toBe(
      "row_modified",
    );
  });

  it("says so when the failure looks like a wrong key rather than an edit", () => {
    // A misconfiguration and a rewritten log fail identically, and an operator
    // told "your audit log has been tampered with" deserves to hear that
    // before they start an incident.
    const v = verifyImpersonationChain(buildChain(4, { secret: "s3cret" }), null);
    expect(v.firstBreak?.index).toBe(0);
    expect(v.note).toContain("IMPERSONATION_CHAIN_SECRET");

    // …and it must NOT say that about a break further down the log, which
    // cannot be a key problem.
    const rows = buildChain(4, { secret: "s3cret" });
    rows[2] = { ...rows[2], adminEmail: "someone@else.example" };
    expect(verifyImpersonationChain(rows, "s3cret").note).toBeNull();
  });

  it("reports whether it was in use, because it changes what a pass means", () => {
    expect(verifyImpersonationChain(buildChain(2)).keyed).toBe(false);
    expect(
      describeChainVerification(verifyImpersonationChain(buildChain(2))),
    ).toContain("unkeyed");
    expect(verifyImpersonationChain(buildChain(2, { secret: "k" }), "k").keyed).toBe(
      true,
    );
  });
});

/**
 * The parts that need the database, asserted against the source instead.
 *
 * Same reasoning as tests/impersonation-invariants.test.ts: this repo has no
 * mocking layer and every suite runs without DATABASE_URL. A blunt test that
 * runs in CI beats a precise one that never does.
 */
describe("the writer and the schema hold up their end", () => {
  const lib = readFileSync(join(ROOT, "lib", "impersonation.ts"), "utf8");
  const schema = readFileSync(join(ROOT, "db", "schema.ts"), "utf8");

  it("there is exactly one insert into impersonation_sessions, and it hashes", () => {
    // A second insert path is how half the table ends up unchained, and it
    // would look exactly like legacy rows — the one thing verification is
    // built to tolerate.
    const inserts = lib.match(/\.insert\(impersonationSessions\)/g) ?? [];
    expect(inserts.length).toBe(1);
    const at = lib.indexOf(".insert(impersonationSessions)");
    const stmt = lib.slice(at, lib.indexOf(";", at));
    expect(stmt).toContain("chainPrevHash");
    expect(stmt).toContain("impersonationRowHash");
  });

  it("the writer anchors the first row to genesis", () => {
    // Without this the head of the chain could be deleted invisibly.
    expect(lib).toContain("impersonationGenesisHash");
  });

  it("the writer supplies started_at itself, truncated to milliseconds", () => {
    // A defaulted now() cannot be hashed (it is not known until after the
    // insert), and an untruncated one hashes to an instant that reads back
    // different — every row would fail for no reason.
    expect(lib).toContain("date_trunc('milliseconds', now())");
    const at = lib.indexOf(".insert(impersonationSessions)");
    expect(lib.slice(at, lib.indexOf(";", at))).toContain("startedAt,");
  });

  it("the fork guard is a real unique index in the schema", () => {
    // The append is read-then-write. Without the unique on chain_prev_hash,
    // two simultaneous entries both commit against the same head and the
    // chain forks — reporting a break nobody caused.
    expect(schema).toContain(
      'uniqueIndex("impersonation_sessions_chain_prev_idx").on(t.chainPrevHash)',
    );
    expect(schema).toContain(
      'uniqueIndex("impersonation_sessions_chain_hash_idx").on(t.chainHash)',
    );
  });

  it("every chained field exists on the table, and no unchained one is claimed", () => {
    const start = schema.indexOf("export const impersonationSessions");
    const block = schema.slice(start, schema.indexOf("\n);", start));
    for (const field of CHAINED_FIELDS) {
      expect(block, `${field} is hashed but not in the table`).toContain(
        `${field}:`,
      );
    }
    // The mutable columns are the honest gap. If one of them ever joins
    // CHAINED_FIELDS the writer has to change too, and this fails first.
    for (const column of UNCHAINED_COLUMNS) {
      expect(CHAINED_FIELDS as readonly string[]).not.toContain(column);
      expect(block).toContain(`${column}:`);
    }
  });

  /*
   * ── CHAINED_FIELDS MUST NOT DRIFT FROM WHAT IS ACTUALLY HASHED ──
   *
   * Found by review, not by the original suite. `payload()` lists the covered
   * fields POSITIONALLY, so CHAINED_FIELDS is a parallel declaration rather
   * than the thing the hash is built from — and deleting "reason" from it left
   * all 25 tests green.
   *
   * That matters because CHAINED_FIELDS is exported for exactly one purpose:
   * so the admin console can tell a client what the chain does and does not
   * seal. A drift here does not weaken the chain — it makes the product
   * MISDESCRIBE the chain to the person relying on it, which is the same class
   * of failure as the sidebar that said billing was not built.
   *
   * Two assertions, because either alone is escapable: the list is pinned
   * literally (catches a field being added or removed), and every field on it
   * is proved to change the hash (catches a field being listed but not
   * actually covered).
   */
  it("declares exactly the fields it hashes", () => {
    expect([...CHAINED_FIELDS]).toEqual([
      "adminId",
      "adminEmail",
      "adminClerkUserId",
      "workspaceId",
      "workspaceName",
      "reason",
      "startedAt",
    ]);
  });

  it("every declared field genuinely changes the hash", () => {
    const base = content(1);
    const prev = impersonationGenesisHash(null);
    const baseline = impersonationRowHash(base, prev, null);

    // A distinct value per field, chosen so none collides with the baseline.
    const altered: Record<string, unknown> = {
      adminId: 999,
      adminEmail: "someone-else@postbox.help",
      adminClerkUserId: "user_zzz",
      workspaceId: 4242,
      workspaceName: "A Different Client",
      reason: "a completely different reason",
      startedAt: new Date(Date.UTC(2027, 0, 1, 0, 0, 0)),
    };

    for (const field of CHAINED_FIELDS) {
      const mutated = { ...base, [field]: altered[field] };
      expect(
        impersonationRowHash(mutated, prev, null),
        `changing ${field} did not change the row hash, so the chain does ` +
          `not actually cover it even though CHAINED_FIELDS says it does`,
      ).not.toBe(baseline);
    }
  });

  it("nothing in the app deletes from this table", () => {
    // The chain makes a deletion detectable; it is still worth nothing being
    // able to do one from inside the product.
    //
    // Only the builder form and raw statements are checked, not every mention
    // of the words. A first version matched /DELETE FROM impersonation_sessions/
    // anywhere in the file and failed on the module's own header comment,
    // which says the sentence in order to explain why the chain exists —
    // teaching the next person that the way past this test is to stop writing
    // the explanation down.
    expect(lib).not.toMatch(/\.delete\(impersonationSessions\)/);
    for (const stmt of lib.match(/sql`[^`]*`/g) ?? []) {
      expect(stmt).not.toMatch(/DELETE\s+FROM\s+impersonation_sessions/i);
    }
  });
});

/**
 * The chain is actually CHECKED by something.
 *
 * ── WHY THIS TEST IS NOT PARANOIA ──
 * The chain shipped complete and correct, with 27 tests, and
 * `verifyImpersonationLog()` had zero callers outside this file. Every
 * impersonation wrote a hash and nothing ever walked it. A tamper-evident log
 * that nobody verifies is not tamper-evident — it is two extra columns and a
 * claim.
 *
 * That is a shape this codebase keeps producing: suppressAddress() with no
 * callers, /search built with nothing linking to it, the delivery webhook
 * before anything read its result. Each was found by a person noticing, which
 * is the part that does not scale.
 */
describe("something actually verifies the chain", () => {
  const CONSOLE_PAGE = readFileSync(
    join(process.cwd(), "app/(admin)/admin/page.tsx"),
    "utf8",
  );
  const CONSOLE_SECTIONS = readFileSync(
    join(process.cwd(), "app/(admin)/admin/sections.tsx"),
    "utf8",
  );

  it("the admin console calls the verifier", () => {
    expect(CONSOLE_PAGE).toContain("verifyImpersonationLog(");
  });

  it("and renders the result rather than discarding it", () => {
    // Calling it and throwing the answer away would satisfy the test above.
    expect(CONSOLE_SECTIONS).toContain("describeChainVerification(");
  });

  it("shows the outcome whether it passes or fails", () => {
    /*
     * A verification that only appears when something is wrong cannot be told
     * apart from one that never ran. Both branches have to be reachable, so
     * the render is asserted to depend on `ok` rather than to be conditional
     * on failure alone.
     */
    expect(CONSOLE_SECTIONS).toMatch(/chain\.ok\s*\?/);
  });
});
