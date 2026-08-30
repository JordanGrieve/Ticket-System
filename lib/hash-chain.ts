import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The hash-chain machinery, with no opinion about what it is chaining.
 *
 * ── WHY THIS WAS EXTRACTED ──
 * lib/impersonation-chain.ts made impersonation_sessions tamper-evident. Then
 * admin_actions arrived, recording something arguably more destructive — an
 * operator deleting a client workspace, which cascades away every ticket,
 * message and subscriber they had. That log needed the same protection, and
 * there were only two ways to give it one: copy the chain, or lift the part
 * that has no domain in it.
 *
 * Copying was the wrong answer. Every other duplication in this codebase is
 * cheap to keep in step because a divergence shows up as a visibly wrong page.
 * Two hash chains that drift do not show up at all — they both keep reporting
 * "intact", and the one with the bug reports it wrongly. This is the one kind
 * of code where a second implementation is strictly worse than a slightly more
 * abstract first one.
 *
 * ── WHAT IS GENERIC AND WHAT IS NOT ──
 * Generic: the digest, the genesis anchor, the constant-time compare, and the
 * walk that decides whether a sequence holds together.
 *
 * NOT generic, and passed in by each caller: which fields are hashed, what a
 * row is called in English ("Session", "Action"), and which environment
 * variable holds the secret. Those all end up in messages an operator reads,
 * and a chain that told somebody to check the wrong environment variable would
 * be worse than one that said nothing.
 *
 * Pure and importable with no DATABASE_URL, like the module it came from.
 */

/** The two columns any chained table carries, plus its key. */
export type ChainableRow = {
  id: number;
  chainPrevHash: string | null;
  chainHash: string | null;
};

/** Hex sha256/hmac-sha256 of a string, keyed when a secret is configured. */
export function chainDigest(input: string, secret: string | null): string {
  return secret
    ? createHmac("sha256", secret).update(input, "utf8").digest("hex")
    : createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * The bytes hashed for one row: a domain tag, the previous hash, then the
 * caller's field values in a fixed order.
 *
 * JSON.stringify of an array rather than a joined string, because these values
 * include free text somebody typed: any separator scheme has to answer what
 * happens when the text contains the separator, and "JSON escapes it" is an
 * answer somebody else already got right. Positional, so nulls survive as null
 * and stay distinguishable from the empty string — "gave no reason" and "typed
 * nothing" are different facts.
 *
 * `domain` is what stops a row from one table verifying against another's
 * chain. It MUST change if the field list changes, and doing so invalidates
 * every existing row by design: there is no migration that keeps old rows
 * verified while changing what "verified" means.
 */
export function chainRowHash(
  domain: string,
  parts: readonly unknown[],
  prevHash: string,
  secret: string | null,
): string {
  return chainDigest(JSON.stringify([domain, prevHash, ...parts]), secret);
}

/**
 * The anchor the first chained row points at.
 *
 * Without it, "the oldest row I can see" and "the oldest row there ever was"
 * are the same statement, and deleting the head of the chain is invisible —
 * the new head simply looks like the beginning. With it, the head is pinned:
 * any first row whose prev hash is not this one has something deleted in front
 * of it. Keyed too, so the anchor itself cannot be forged from the database.
 */
export function chainGenesis(domain: string, secret: string | null): string {
  return chainDigest(JSON.stringify([domain, "genesis"]), secret);
}

/** Constant-time compare, so verification leaks no timing signal. */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type ChainBreakKind =
  /** This row's stored hash does not match this row's contents. */
  | "row_modified"
  /** This row's predecessor is not the row that precedes it any more. */
  | "row_removed"
  /** The chain does not start at genesis: its first row(s) are gone. */
  | "chain_head_removed"
  /** A row with no hash at all, after the chain had already started. */
  | "unchained_row"
  /** Only one of the two chain columns is populated. */
  | "partial_hash";

export type ChainBreak = {
  /** Position in the id-ascending sequence. 0 is the oldest row supplied. */
  index: number;
  /** The id of the row AT that position — the one to go and look at. */
  id: number;
  kind: ChainBreakKind;
  /** Plain English, for an operator who is not going to read this file. */
  detail: string;
};

export type ChainVerification = {
  /** True only if every chained row verified. Legacy rows do not count. */
  ok: boolean;
  /** Whether a secret was in use. False means forgery is cheap — say so. */
  keyed: boolean;
  /** Rows supplied. */
  total: number;
  /** Rows from before the chain existed. NOT verified and NOT verifiable. */
  legacyUnverified: number;
  /** Chained rows that verified, up to the first break. */
  verified: number;
  /** The first place the chain stops holding together. Null if it holds. */
  firstBreak: ChainBreak | null;
  /**
   * Set when the shape of the failure suggests the wrong secret rather than an
   * edit — a whole chain that fails at its very first row.
   */
  note: string | null;
};

/** What a caller has to tell the walk about its own domain. */
export type ChainSpec<R extends ChainableRow> = {
  /** Domain tag, matching the one used when the rows were written. */
  domain: string;
  secret: string | null;
  /** Recompute a row's own hash, given the prev hash stored on it. */
  hashOf: (row: R, prevHash: string) => string;
  /** What one row is called, capitalised: "Session", "Action". */
  noun: string;
  /** Which fields an edit would have touched, for the message. */
  editableFields: string;
  /** The writer a legitimate row must have gone through, for the message. */
  writer: string;
  /** Environment variable holding the secret, named in the wrong-key note. */
  secretEnvName: string;
};

/**
 * Walk a sequence of rows and report the FIRST place it stops holding.
 *
 * ── ORDERING ──
 * Rows are verified in ASCENDING id order and the caller need not supply them
 * that way — a copy is sorted here, so a screen listing newest first can pass
 * its rows straight in.
 *
 * Ordering by id rather than by a timestamp is deliberate. A timestamp is not
 * a key: two writes can land in the same millisecond, and ties would make the
 * order of the chain ambiguous, which would make a failure ambiguous too. `id`
 * is a serial, unique, and — the part that needed checking rather than
 * assuming — issued in the same order the chain is appended in, even under
 * concurrency, BECAUSE the writer reads the head then inserts and a UNIQUE
 * index on chain_prev_hash stops two racers committing against the same head.
 * The loser retries, draws a fresh sequence value, and lands both later in the
 * chain and higher in id.
 *
 * That is a property of the writers, not a law of Postgres, so this does not
 * lean on it alone: id order lays the rows out, and the prev-hash links are
 * then required to agree with that layout. A future writer that breaks the
 * property gets a reported break rather than a pass.
 *
 * ── ROWS THAT PREDATE THE CHAIN ──
 * Both columns NULL. They CANNOT be honestly retro-hashed: computing hashes
 * now would only prove the rows say what they say today, which is the one
 * thing in doubt. A backfill produces a log that verifies clean and means
 * nothing — worse than an unverified prefix, because it looks better.
 *
 * So they are counted, reported as `legacyUnverified`, and never called
 * verified. They are tolerated only as a CONTIGUOUS PREFIX: a null-hash row
 * appearing after the chain has started is not a legacy row, it is one that
 * bypassed the writer or had its hashes stripped, and it is a break.
 */
export function verifyHashChain<R extends ChainableRow>(
  rows: readonly R[],
  spec: ChainSpec<R>,
): ChainVerification {
  const ordered = [...rows].sort((a, b) => a.id - b.id);
  const genesis = chainGenesis(spec.domain, spec.secret);

  let legacyUnverified = 0;
  let verified = 0;
  let previousHash: string | null = null;
  let started = false;

  const result = (firstBreak: ChainBreak | null): ChainVerification => ({
    ok: firstBreak === null,
    keyed: spec.secret !== null,
    total: ordered.length,
    legacyUnverified,
    verified,
    firstBreak,
    note:
      firstBreak && firstBreak.index === legacyUnverified && verified === 0
        ? "The very first chained row already fails. Before treating this as " +
          `tampering, check that ${spec.secretEnvName} is the same value the ` +
          "rows were written with — a wrong or missing secret fails " +
          "identically to a forged log."
        : null,
  });

  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index];
    const hasHash = row.chainHash !== null;
    const hasPrev = row.chainPrevHash !== null;

    if (hasHash !== hasPrev) {
      return result({
        index,
        id: row.id,
        kind: "partial_hash",
        detail:
          `${spec.noun} #${row.id} has one chain column filled and the other ` +
          "empty. No writer produces that; one of the columns has been " +
          "cleared by hand.",
      });
    }

    if (!hasHash) {
      if (started) {
        return result({
          index,
          id: row.id,
          kind: "unchained_row",
          detail:
            `${spec.noun} #${row.id} carries no hash, but rows before it do. ` +
            "Rows that predate the chain are all older than every chained " +
            `row, so this one was either inserted without going through ` +
            `${spec.writer}, or had its hashes cleared.`,
        });
      }
      legacyUnverified++;
      continue;
    }

    started = true;
    const prevHash = row.chainPrevHash as string;
    const expectedPrev = previousHash ?? genesis;

    // Own contents first: an edited row is a different statement from a
    // missing neighbour, and the edited row is the one to go and read.
    const recomputed = spec.hashOf(row, prevHash);
    if (!hashesEqual(recomputed, row.chainHash as string)) {
      return result({
        index,
        id: row.id,
        kind: "row_modified",
        detail:
          `${spec.noun} #${row.id} does not hash to the value stored on it. ` +
          `Its ${spec.editableFields} has been changed since it was written.`,
      });
    }

    if (!hashesEqual(prevHash, expectedPrev)) {
      return result({
        index,
        id: row.id,
        kind: previousHash === null ? "chain_head_removed" : "row_removed",
        detail:
          previousHash === null
            ? `${spec.noun} #${row.id} is the oldest chained row, but it does ` +
              "not point at the start of the chain. One or more rows that " +
              "came before it have been deleted."
            : `${spec.noun} #${row.id} points at a row that is not the row ` +
              "before it. At least one row between it and the previous row " +
              "has been deleted.",
      });
    }

    previousHash = row.chainHash;
    verified++;
  }

  return result(null);
}

/*
  There is deliberately no shared describeChain() here.

  Each chained table needs its own sentence — "3 chained sessions verify
  against each other" and "3 recorded actions verify against each other" are
  not the same words, and a generic version ends up saying "rows", which is
  what a database says rather than what a person asks about. The wording is a
  dozen lines of string assembly per domain and carries no risk; the crypto and
  the walk, which do, are shared above.
*/
