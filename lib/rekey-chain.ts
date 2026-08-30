import type { ChainVerification } from "./hash-chain";

/**
 * Planning a one-time re-hash of an audit chain under a new secret.
 *
 * Pure: no database, no environment. db/rekey-chains.ts does the IO and calls
 * this to decide what to write — the same split as lib/onboarding.ts against
 * lib/onboarding-query.ts, and for a sharper reason here. This code rewrites
 * the audit log. The rules that decide whether it is allowed to, and what it
 * would write, must be provable without a connection to anything.
 *
 * ── WHY A RE-HASH IS EVER CORRECT ──
 * The chains shipped unkeyed. Setting a secret turns each hash into an HMAC,
 * but nothing re-hashes itself: verification recomputes from the genesis
 * anchor, every existing row disagrees, and the console reports the log broken
 * forever. An alarm that is always on is one nobody reads. So the rows are
 * rewritten once, deliberately, with the guards below.
 *
 * ── THE GUARD THAT MATTERS ──
 * Re-hashing is refused unless the chain ALREADY verifies under the old
 * secret. A chain that does not verify is either tampered with or was written
 * by something that bypassed the writer; either way the current hashes are
 * evidence, and rewriting them would replace a log that is shouting with one
 * that looks pristine. There is deliberately no override.
 */

/** The minimum a row must expose to be re-hashed. */
export type RekeyableRow = {
  id: number;
  chainPrevHash: string | null;
  chainHash: string | null;
};

export type RekeyWrite = {
  id: number;
  chainPrevHash: string;
  chainHash: string;
};

export type RekeyPlan =
  | {
      ok: true;
      /** Rows to rewrite, in id order. */
      writes: RekeyWrite[];
      /** Rows left exactly as they are because they predate the chain. */
      untouched: number;
      /** The re-hashed chain, verified under the NEW secret before any write. */
      after: ChainVerification;
    }
  | { ok: false; reason: RekeyRefusal; detail: string };

export type RekeyRefusal =
  /** The chain does not verify under the secret it was written with. */
  | "not_verified"
  /** A row carries one chain column but not the other. */
  | "partial_hash"
  /** The plan itself does not verify. A bug here, not bad data. */
  | "replan_failed";

export type RekeyInput<R extends RekeyableRow> = {
  /** Every row, in id order. */
  rows: readonly R[];
  /** The secret the rows were written with. Null when the chain is unkeyed. */
  oldSecret: string | null;
  /** The secret to rewrite them under. */
  newSecret: string;
  verify: (rows: readonly R[], secret: string | null) => ChainVerification;
  genesis: (secret: string | null) => string;
  rowHash: (row: R, prevHash: string, secret: string | null) => string;
};

export function planRekey<R extends RekeyableRow>(
  input: RekeyInput<R>,
): RekeyPlan {
  const { rows, oldSecret, newSecret, verify, genesis, rowHash } = input;

  if (rows.length === 0) {
    return {
      ok: true,
      writes: [],
      untouched: 0,
      after: verify([], newSecret),
    };
  }

  /*
    THE GUARD. See the header. Deliberately first, before anything is
    computed, so there is no path where a plan exists for a broken chain.
  */
  const before = verify(rows, oldSecret);
  if (!before.ok) {
    return {
      ok: false,
      reason: "not_verified",
      detail:
        before.firstBreak?.detail ??
        "the chain does not verify under the current secret",
    };
  }

  /*
    A row with one chain column filled and not the other is not a pre-chain
    row and not a chained one. verify() already treats it as a break, so this
    is unreachable while that holds — it is here so that a future change to
    the verifier cannot silently turn such a row into a skipped one.
  */
  const partial = rows.find(
    (r) => (r.chainHash === null) !== (r.chainPrevHash === null),
  );
  if (partial) {
    return {
      ok: false,
      reason: "partial_hash",
      detail: `row #${partial.id} has one chain column filled and the other empty`,
    };
  }

  /*
    Pre-chain rows keep their NULLs. lib/impersonation-chain.ts: retro-hashing
    them "would produce a log that verifies clean and means nothing, and that
    is a worse outcome than an unverified prefix, because it looks better."
    That reasoning does not change because a secret is being introduced.
  */
  const chained = rows.filter(
    (r) => r.chainHash !== null && r.chainPrevHash !== null,
  );

  let prev = genesis(newSecret);
  const writes: RekeyWrite[] = [];
  const proposed: R[] = [];
  for (const row of chained) {
    // The row itself, not a copy with the new columns spliced in: a row's hash
    // covers its CONTENT fields, and the chain columns are the framing the
    // hash goes into. Passing a half-updated copy would work today and be
    // wrong the moment a chain covers a column this function edits.
    const hash = rowHash(row, prev, newSecret);
    writes.push({ id: row.id, chainPrevHash: prev, chainHash: hash });
    proposed.push({ ...row, chainPrevHash: prev, chainHash: hash });
    prev = hash;
  }

  /*
    Verify the plan before it is written, against the same verifier the console
    will use. Cheap, and it turns a botched rewrite from something found
    afterwards against a half-written table into something found now against
    nothing.
  */
  const after = verify(proposed, newSecret);
  if (!after.ok) {
    return {
      ok: false,
      reason: "replan_failed",
      detail:
        after.firstBreak?.detail ??
        "the re-hashed chain does not verify under the new secret",
    };
  }

  return {
    ok: true,
    writes,
    untouched: rows.length - chained.length,
    after,
  };
}
