import {
  chainGenesis,
  chainRowHash,
  verifyHashChain,
  type ChainBreak,
  type ChainBreakKind,
  type ChainVerification,
} from "./hash-chain";

/*
 * The generic machinery moved to lib/hash-chain.ts when admin_actions needed
 * the same protection. Nothing about the hashing changed: chainRowHash and
 * chainGenesis produce byte-identical output to the private helpers they
 * replaced, so rows written before the extraction still verify. That was the
 * constraint the refactor had to meet, and this file's own tests — which were
 * not modified — are what proves it did.
 */
export type { ChainBreak, ChainBreakKind, ChainVerification };

/**
 * The hash chain that makes the impersonation log tamper-EVIDENT.
 *
 * ── WHAT THIS IS NOT ──
 * It is not tamper-PROOF, and nothing in this file should ever be described
 * that way to a client. The app connects to Neon as an owner-level role, so
 * anyone holding DATABASE_URL can still run DELETE FROM impersonation_sessions.
 * Stopping that is an infrastructure decision (a restricted role with no
 * DELETE, or shipping rows to append-only external storage) and it does not
 * live in this repo.
 *
 * What this file does is change what a deletion or an edit COSTS. Every row
 * carries a hash over its own entry facts plus the hash of the row before it,
 * so the rows are a linked list that only holds together if all of them are
 * present and unedited. Remove one and its successor points at a hash that is
 * no longer there. Edit one and its own hash stops matching its contents.
 * Neither is visible in the row itself — you have to walk the chain — which is
 * exactly what verifyImpersonationChain does.
 *
 * ── THE KEY, AND WHY IT MATTERS MORE THAN THE HASH ──
 * An UNKEYED chain catches accident and carelessness: a stray DELETE, a
 * botched migration, an UPDATE run against the wrong row. It does NOT catch a
 * determined operator, because the algorithm here is public and they can
 * simply recompute every hash from the row they edited onward and leave a
 * chain that verifies perfectly.
 *
 * Set IMPERSONATION_CHAIN_SECRET and the hash becomes an HMAC. Recomputing
 * the chain then requires the secret, which is NOT in the database and is not
 * needed by anyone doing database maintenance — so a person holding only
 * DATABASE_URL (a Neon console session, a leaked connection string, a psql
 * shell) can destroy the log but cannot rewrite it undetectably. That is the
 * whole of the security gain here, and it is real but narrow: it does not
 * help against someone who also has the application's environment.
 *
 * The secret CANNOT be rotated. Rotating it would require re-hashing every
 * existing row, which is precisely the operation this file exists to make
 * detectable — a rotation and a forgery are the same edit. Choose it once,
 * store it where the DATABASE_URL holder is not, and leave it alone.
 *
 * ── WHAT THE CHAIN COVERS, AND WHAT IT DOES NOT ──
 * COVERED: the entry facts, which are the ones that answer a client's actual
 * question — which operator, which workspace, why, and when they went in.
 *
 * NOT COVERED: lastSeenAt, endedAt and endedReason. Those are written by the
 * heartbeat and by whatever observes the exit, i.e. AFTER the row is inserted,
 * and a chain cannot cover a value that legitimately changes later: re-hashing
 * a row on every heartbeat would invalidate every row after it. So an operator
 * with write access can still lengthen or shorten a recorded session, or
 * change how it ended, without breaking anything here. Covering that honestly
 * needs a second append-only table with one row per event rather than one row
 * per session, which is a bigger change than this task and is NOT done.
 *
 * ALSO NOT COVERED: truncation of the TAIL. Deleting the most recent rows
 * leaves a chain that is internally perfect, because the only thing that would
 * have pointed at them is a row that no longer exists. This is inherent to a
 * hash chain and cannot be fixed from inside the table; it needs an anchor
 * kept somewhere else (a periodic checkpoint of the head hash shipped
 * off-site, or an external append-only store). Do not claim otherwise.
 *
 * This module is PURE and imports nothing from db/, on purpose: it is the part
 * that has to be testable, and CI has no DATABASE_URL.
 */

/**
 * Domain separation, and the version of the hashed payload shape.
 *
 * If the covered field list ever changes, this string MUST change with it —
 * and then every existing row stops verifying, which is why the field list is
 * not something to revise casually. There is no v2 migration path that keeps
 * old rows verified, by construction.
 */
const PAYLOAD_VERSION = "postbox.impersonation-chain.v1";


/**
 * The row fields the chain covers, in the order they are hashed.
 *
 * Exported so the admin console can SHOW a client what is and is not sealed
 * rather than leaving them to infer it, and so a test can assert the list has
 * not drifted from the schema.
 */
export const CHAINED_FIELDS = [
  "adminId",
  "adminEmail",
  "adminClerkUserId",
  "workspaceId",
  "workspaceName",
  "reason",
  "startedAt",
] as const;

/**
 * The columns the chain does NOT cover, and why. Same reason for exporting:
 * an honest UI needs to be able to say this out loud.
 */
export const UNCHAINED_COLUMNS = [
  "lastSeenAt",
  "endedAt",
  "endedReason",
] as const;

/** The subset of an impersonation_sessions row the chain reads. */
export type ImpersonationChainRow = {
  id: number;
  adminId: number | null;
  adminEmail: string;
  adminClerkUserId: string | null;
  workspaceId: number | null;
  workspaceName: string;
  reason: string | null;
  /** A Date from the driver, or the ISO string it parses from. */
  startedAt: Date | string;
  /** Null on rows written before the chain existed. See verify below. */
  chainPrevHash: string | null;
  chainHash: string | null;
};

/** The entry facts of a row, before it has been given an id or a hash. */
export type ImpersonationChainContent = Pick<
  ImpersonationChainRow,
  (typeof CHAINED_FIELDS)[number]
>;

/**
 * Timestamps are hashed as UTC milliseconds-precision ISO text.
 *
 * Postgres timestamptz carries MICROseconds and a JS Date does not, so a row
 * hashed from a Date and re-read later would disagree with itself on the
 * microsecond digits. The writer therefore stores started_at already truncated
 * to milliseconds (date_trunc in lib/impersonation.ts) so that what is hashed
 * and what is stored are the same instant, exactly, in both directions.
 */
function isoMillis(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

/**
 * The field VALUES, in the order they are hashed.
 *
 * The framing (domain tag, prev hash, JSON encoding) is lib/hash-chain.ts;
 * this file owns only which facts are covered and in what order. Positional,
 * so nulls stay distinguishable from the empty string — "gave no reason" and
 * "typed nothing" are different facts.
 */
function parts(content: ImpersonationChainContent): unknown[] {
  return [
    content.adminId,
    content.adminEmail,
    content.adminClerkUserId,
    content.workspaceId,
    content.workspaceName,
    content.reason,
    isoMillis(content.startedAt),
  ];
}

/**
 * The hash stored on a row. The writer calls this before INSERT; the verifier
 * calls it again on what came back. One implementation, so there is no second
 * one to drift.
 */
export function impersonationRowHash(
  content: ImpersonationChainContent,
  prevHash: string,
  secret: string | null,
): string {
  return chainRowHash(PAYLOAD_VERSION, parts(content), prevHash, secret);
}

/**
 * The anchor the first chained row points at.
 *
 * Without it, "the oldest row I can see" and "the oldest row there ever was"
 * would be the same statement, and deleting the head of the chain would be
 * invisible — the new head would simply look like the beginning. With it, the
 * head is pinned: any first row whose prev hash is not this one is a first row
 * with something deleted in front of it.
 *
 * It is keyed too when a secret is set, so the anchor itself cannot be forged
 * by someone who only holds the database.
 */
export function impersonationGenesisHash(secret: string | null): string {
  return chainGenesis(PAYLOAD_VERSION, secret);
}



/**
 * Walk a sequence of rows and report the FIRST place it stops holding.
 *
 * ── ORDERING ──
 * Rows are verified in ASCENDING id order, and the caller does not have to
 * supply them that way — a copy is sorted here so a screen that lists newest
 * first can pass its rows straight in.
 *
 * Ordering by id rather than by started_at is deliberate. started_at is not a
 * key: two operators can enter two workspaces in the same millisecond, and
 * ties would make the order of the chain ambiguous, which would make a
 * verification failure ambiguous too. id is a serial, unique, and — this is
 * the part that needed checking rather than assuming — issued in the same
 * order the chain is appended in, even under concurrency. The writer reads the
 * current head hash and then inserts, and a UNIQUE index on chain_prev_hash
 * means the second of two racing inserts cannot commit against a head that has
 * been taken: it fails and retries, and the retry draws a FRESH sequence value,
 * which is necessarily larger than the winner's. So the loser is always both
 * later in the chain and higher in id. See appendImpersonationRow.
 *
 * That is a property of the writer, not a law of Postgres, so this function
 * does not lean on it alone: id order is used to lay the rows out, and the
 * prev-hash links are then required to agree with that layout. If a future
 * writer breaks the property, this reports it as a break rather than passing.
 *
 * ── ROWS THAT PREDATE THE CHAIN ──
 * Rows written before this shipped have both chain columns NULL, and they
 * CANNOT be honestly retro-hashed: computing hashes for them now would only
 * prove that the rows say what they say today, which is the one thing in doubt.
 * A backfill would produce a log that verifies clean and means nothing, and
 * that is a worse outcome than an unverified prefix, because it looks better.
 *
 * So they are counted, reported as `legacyUnverified`, and never called
 * verified. They are tolerated only as a CONTIGUOUS PREFIX: a null-hash row
 * appearing after the chain has started is not a legacy row, it is a row
 * inserted by something that bypassed the writer (or a row whose hash was
 * stripped), and it is reported as a break.
 */
export function verifyImpersonationChain(
  rows: readonly ImpersonationChainRow[],
  secret: string | null = null,
): ChainVerification {
  return verifyHashChain(rows, {
    domain: PAYLOAD_VERSION,
    secret,
    hashOf: (row, prevHash) => impersonationRowHash(row, prevHash, secret),
    noun: "Session",
    editableFields: "operator, workspace, reason or start time",
    writer: "startImpersonation",
    secretEnvName: "IMPERSONATION_CHAIN_SECRET",
  });
}

/**
 * One-line summary for an operator or a client. Deliberately refuses to say
 * "verified" about the legacy rows, and refuses to say "tamper-proof" at all.
 */
export function describeChainVerification(v: ChainVerification): string {
  const keyNote = v.keyed
    ? ""
    : " (unkeyed: this detects accidents and careless edits, not a " +
      "deliberate rewrite)";
  const legacy =
    v.legacyUnverified > 0
      ? ` ${v.legacyUnverified} older row${
          v.legacyUnverified === 1 ? "" : "s"
        } predate the chain and cannot be verified either way.`
      : "";

  if (!v.firstBreak) {
    return `${v.verified} chained session${
      v.verified === 1 ? "" : "s"
    } verify against each other${keyNote}.${legacy}`;
  }

  return `Chain breaks at session #${v.firstBreak.id} (row ${
    v.firstBreak.index + 1
  } of ${v.total}): ${v.firstBreak.detail}${legacy}`;
}
