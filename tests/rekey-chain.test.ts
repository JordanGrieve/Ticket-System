import { describe, it, expect } from "vitest";
import { planRekey, type RekeyableRow } from "../lib/rekey-chain";
import {
  impersonationGenesisHash,
  impersonationRowHash,
  verifyImpersonationChain,
  type ImpersonationChainRow,
} from "../lib/impersonation-chain";

/**
 * Re-hashing the audit chain under a new secret.
 *
 * This is the one operation in the product that deliberately rewrites the
 * audit log, so it gets the most sceptical tests here. The chain modules are
 * the real ones — no stubs — so what passes is what db/rekey-chains.ts will do
 * against production.
 */

const NEW = "a".repeat(64);

/** Build a chain of n rows hashed under `secret`, exactly as the writer does. */
function chainOf(n: number, secret: string | null): ImpersonationChainRow[] {
  const rows: ImpersonationChainRow[] = [];
  let prev = impersonationGenesisHash(secret);
  for (let i = 1; i <= n; i++) {
    const content = {
      adminId: 1,
      adminEmail: "operator@postbox.help",
      adminClerkUserId: `user_${i}`,
      workspaceId: 10 + i,
      workspaceName: `Client ${i}`,
      reason: i % 2 === 0 ? null : `looking into #${i}`,
      startedAt: new Date(Date.UTC(2026, 7, 30, 9, i, 0)),
    };
    const hash = impersonationRowHash(content, prev, secret);
    rows.push({ id: i, ...content, chainPrevHash: prev, chainHash: hash });
    prev = hash;
  }
  return rows;
}

const plan = (rows: readonly ImpersonationChainRow[], oldSecret: string | null) =>
  planRekey({
    rows,
    oldSecret,
    newSecret: NEW,
    verify: verifyImpersonationChain,
    genesis: impersonationGenesisHash,
    rowHash: (row, prevHash, secret) =>
      impersonationRowHash(row, prevHash, secret),
  });

describe("re-keying an unkeyed chain", () => {
  it("produces a chain that verifies under the new secret", () => {
    const rows = chainOf(5, null);
    // Precondition: it verifies unkeyed and does NOT verify under the new key.
    expect(verifyImpersonationChain(rows, null).ok).toBe(true);
    expect(verifyImpersonationChain(rows, NEW).ok).toBe(false);

    const result = plan(rows, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.writes).toHaveLength(5);
    expect(result.after.ok).toBe(true);
    expect(result.after.keyed).toBe(true);
    expect(result.after.verified).toBe(5);
  });

  it("actually changes every hash", () => {
    // A plan that returned the existing hashes would "verify" trivially and
    // leave the log exactly as unkeyed as it was.
    const rows = chainOf(4, null);
    const result = plan(rows, null);
    if (!result.ok) throw new Error("expected a plan");

    for (const w of result.writes) {
      const before = rows.find((r) => r.id === w.id)!;
      expect(w.chainHash).not.toBe(before.chainHash);
      expect(w.chainPrevHash).not.toBe(before.chainPrevHash);
    }
  });

  it("re-anchors the first row to the new keyed genesis", () => {
    // The anchor is what makes deleting the HEAD of the chain visible. If it
    // were left pointing at the unkeyed genesis, the new chain would verify
    // from row two onward and the head would be unpinned.
    const result = plan(chainOf(3, null), null);
    if (!result.ok) throw new Error("expected a plan");
    expect(result.writes[0].chainPrevHash).toBe(impersonationGenesisHash(NEW));
  });

  it("is idempotent — re-running against the new secret is a no-op in effect", () => {
    const rows = chainOf(3, null);
    const first = plan(rows, null);
    if (!first.ok) throw new Error("expected a plan");

    const rekeyed = rows.map((r, i) => ({
      ...r,
      chainPrevHash: first.writes[i].chainPrevHash,
      chainHash: first.writes[i].chainHash,
    }));
    const second = plan(rekeyed, NEW);
    if (!second.ok) throw new Error("expected a second plan");
    expect(second.writes).toEqual(first.writes);
  });
});

describe("re-keying REFUSES a chain that does not already verify", () => {
  /*
   * THE PROPERTY THIS FILE EXISTS FOR.
   *
   * Re-hashing a broken chain would replace the evidence of the break with
   * hashes that verify perfectly — converting a log that is shouting about
   * tampering into one that looks pristine. There is no override flag, and
   * these are the ways a chain can be broken.
   */
  it("refuses when a middle row's content was edited", () => {
    const rows = chainOf(5, null);
    rows[2] = { ...rows[2], reason: "a reason somebody changed later" };
    expect(verifyImpersonationChain(rows, null).ok).toBe(false);

    const result = plan(rows, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_verified");
  });

  it("refuses when a row has been deleted from the middle", () => {
    const rows = chainOf(5, null);
    rows.splice(2, 1);
    const result = plan(rows, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_verified");
  });

  it("refuses when the head has been deleted", () => {
    // The genesis anchor is what makes this visible at all.
    const rows = chainOf(5, null).slice(1);
    const result = plan(rows, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_verified");
  });

  it("refuses when handed the wrong old secret", () => {
    // A wrong secret fails identically to a forged log, which is exactly why
    // this must refuse rather than "fix" it by rewriting.
    const rows = chainOf(3, "b".repeat(64));
    const result = plan(rows, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_verified");
  });
});

describe("re-keying leaves pre-chain rows alone", () => {
  it("never retro-hashes rows that predate the chain", () => {
    /*
     * lib/impersonation-chain.ts: hashing these now "would produce a log that
     * verifies clean and means nothing, and that is a worse outcome than an
     * unverified prefix, because it looks better." Introducing a secret does
     * not change that argument.
     */
    const legacy: ImpersonationChainRow[] = [
      {
        id: 1,
        adminId: 1,
        adminEmail: "old@postbox.help",
        adminClerkUserId: null,
        workspaceId: 1,
        workspaceName: "Before the chain",
        reason: null,
        startedAt: new Date(Date.UTC(2026, 6, 1)),
        chainPrevHash: null,
        chainHash: null,
      },
    ];
    const chained = chainOf(3, null).map((r) => ({ ...r, id: r.id + 1 }));
    // Rebuild the chained tail so it still links correctly after the id shift.
    const rows = [...legacy, ...chained];

    const result = plan(rows, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.untouched).toBe(1);
    expect(result.writes.map((w) => w.id)).not.toContain(1);
    expect(result.writes).toHaveLength(3);
  });

  it("simulates the WHOLE table, not just the rows it rewrites", () => {
    /*
     * The first production run printed "1 verified, 0 pre-chain, 1 total" for
     * a table of 10 rows with 9 pre-chain ones, because the simulation ran
     * over the rewritten subset alone. Two problems: the line could not be
     * compared against the "before" line above it, and it did not exercise the
     * rule that pre-chain rows are tolerated only as a CONTIGUOUS PREFIX.
     */
    const legacy: ImpersonationChainRow[] = [
      {
        id: 1,
        adminId: 1,
        adminEmail: "old@postbox.help",
        adminClerkUserId: null,
        workspaceId: 1,
        workspaceName: "Before the chain",
        reason: null,
        startedAt: new Date(Date.UTC(2026, 6, 1)),
        chainPrevHash: null,
        chainHash: null,
      },
    ];
    const rows = [
      ...legacy,
      ...chainOf(3, null).map((r) => ({ ...r, id: r.id + 1 })),
    ];

    const result = plan(rows, null);
    if (!result.ok) throw new Error("expected a plan");

    // The counts must describe the table, so they line up with "before".
    expect(result.after.total).toBe(4);
    expect(result.after.legacyUnverified).toBe(1);
    expect(result.after.verified).toBe(3);
  });

  it("refuses when a pre-chain row is NOT a contiguous prefix", () => {
    // A null-hash row appearing after the chain has started is not a legacy
    // row — it is one inserted by something that bypassed the writer. The
    // simulation now covers this rather than leaning on the before-guard.
    const rows = chainOf(4, null);
    rows[2] = { ...rows[2], chainPrevHash: null, chainHash: null };
    const result = plan(rows, null);
    expect(result.ok).toBe(false);
  });
});

describe("re-keying an empty log", () => {
  it("plans nothing rather than failing", () => {
    const result = plan([], null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toEqual([]);
  });
});

describe("the planner is generic, not impersonation-specific", () => {
  it("refuses a row with one chain column filled and the other empty", () => {
    // Unreachable while the verifier treats this as a break, which it does.
    // Asserted so a future change to the verifier cannot silently turn such a
    // row into one this skips.
    const rows: RekeyableRow[] = [
      { id: 1, chainPrevHash: "abc", chainHash: null },
    ];
    const result = planRekey({
      rows,
      oldSecret: null,
      newSecret: NEW,
      // A verifier that waves everything through, to isolate the second guard.
      verify: () => ({
        ok: true,
        keyed: false,
        total: 1,
        legacyUnverified: 0,
        verified: 1,
        firstBreak: null,
        note: null,
      }),
      genesis: () => "genesis",
      rowHash: () => "hash",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("partial_hash");
  });
});
