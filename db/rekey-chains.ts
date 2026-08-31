// Before ./index, so DATABASE_URL is present when the connection is built.
// The same import every other script here uses — "dotenv/config" alone reads
// .env and misses .env.local, which is where the connection string lives.
import "./env";
import { asc, eq } from "drizzle-orm";
import { db } from "./index";
import { impersonationSessions, adminActions } from "./schema";
import {
  impersonationGenesisHash,
  impersonationRowHash,
  verifyImpersonationChain,
  type ImpersonationChainRow,
} from "../lib/impersonation-chain";
import {
  adminActionGenesisHash,
  adminActionRowHash,
  verifyAdminActionChain,
  type AdminActionChainRow,
} from "../lib/admin-actions-chain";
import type { ChainVerification } from "../lib/hash-chain";
import { planRekey, type RekeyableRow } from "../lib/rekey-chain";

/**
 * Re-hash the audit chains under a new secret. ONE TIME, DELIBERATELY.
 *
 * ── WHY THIS EXISTS AT ALL ──
 * The chains shipped unkeyed. An unkeyed chain catches accidents — a stray
 * DELETE, a bad migration, an UPDATE against the wrong row — but not a
 * determined edit, because the algorithm is public and anyone holding
 * DATABASE_URL can recompute every hash from the row they changed onward.
 * Setting IMPERSONATION_CHAIN_SECRET / ADMIN_ACTION_CHAIN_SECRET turns each
 * hash into an HMAC and closes that gap.
 *
 * But the existing rows were hashed with no secret. Set the secret and nothing
 * re-hashes itself: verification recomputes from the genesis anchor, every
 * chained row disagrees, and the console reports CHAIN BROKEN — permanently,
 * about a log nobody touched. An alarm that is always on is one nobody reads,
 * which would leave the product worse off than it was unkeyed.
 *
 * So the rows have to be rewritten once, under the new secret. That is exactly
 * the operation lib/impersonation-chain.ts exists to make detectable, which is
 * why it is a committed, reviewed script with the guards below rather than a
 * paste into a psql shell.
 *
 * ── THE GUARD THAT MATTERS ──
 * It refuses unless the chain ALREADY VERIFIES under the old secret.
 *
 * That is the whole safety argument. Re-hashing a chain that is currently
 * broken would overwrite the evidence of the break with hashes that verify
 * perfectly — turning a log that was shouting about tampering into one that
 * looks pristine. If verification fails first, this script stops and tells you
 * to investigate, and there is no flag to make it continue.
 *
 * ── WHAT IT DOES NOT TOUCH ──
 * Rows with both chain columns NULL predate the chain entirely. They are left
 * exactly as they are. lib/impersonation-chain.ts is explicit that retro-
 * hashing them "would produce a log that verifies clean and means nothing",
 * and that reasoning does not change here.
 *
 * ── RUNNING IT ──
 *   1. Set the secret in Vercel (Production), so the deployed app agrees with
 *      what this writes. Do that FIRST: between the write and the deploy the
 *      console will report the chain broken, and it is better for that window
 *      to be short and expected than for it to be a surprise.
 *   2. Dry run, which writes nothing:
 *        ALLOW_PRODUCTION_DB=1 NEW_CHAIN_SECRET=... npx tsx db/rekey-chains.ts
 *   3. Read the plan it prints, then commit:
 *        ALLOW_PRODUCTION_DB=1 NEW_CHAIN_SECRET=... npx tsx db/rekey-chains.ts --write
 *
 * One value covers both chains; see the note above SHARED for why that is safe
 * and how to give them separate ones instead.
 *
 * The new secrets are read from the environment and never printed. The OLD
 * ones come from the same variables the app uses, so an unkeyed log needs them
 * simply left unset, which is the situation this was written for.
 *
 * ── AFTERWARDS ──
 * The secret cannot be rotated again without running this again, and every
 * rotation is indistinguishable from a forgery to anyone reading the database.
 * Choose it once, store it where the DATABASE_URL holder is not, and leave it.
 */

const WRITE = process.argv.includes("--write");

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/*
  ── ONE SECRET FOR BOTH CHAINS, OR TWO? ──

  Either works. NEW_CHAIN_SECRET sets both; NEW_IMPERSONATION_CHAIN_SECRET and
  NEW_ADMIN_ACTION_CHAIN_SECRET override it per chain.

  Sharing one is SAFE, and not merely convenient. Reusing an HMAC key across
  two uses is dangerous when the same message could be valid under both; here
  it cannot be, because lib/hash-chain.ts puts a domain tag as the FIRST
  element of every hashed payload — including the genesis anchor — and the two
  tags differ ("postbox.impersonation-chain.v1" against
  "postbox.admin-actions-chain.v1"). A row lifted from one table therefore
  cannot verify against the other's chain whatever the key is, which is the
  exact condition that makes reuse sound. tests/admin-audit.test.ts already
  pins that separation.

  What two keys would buy is narrow: it is one more thing to store, and both
  live in the same application environment anyway, so anyone who can read one
  can read the other. It does not defend against the threat this exists for —
  somebody holding only DATABASE_URL — because that person has neither.

  The choice is offered rather than made here because it is a security posture
  decision, and a script that quietly forced key reuse would be making it
  invisibly.
*/
const SHARED = (process.env.NEW_CHAIN_SECRET ?? "").trim();

function newSecretFor(name: string, specific: string | undefined): string {
  const value = (specific ?? "").trim() || SHARED;

  if (value.length === 0) {
    fail(
      `No new secret for ${name}.\n\n` +
        "  Generate one with:\n" +
        "    node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n\n" +
        "  Then either set NEW_CHAIN_SECRET for both chains, or set\n" +
        "  NEW_IMPERSONATION_CHAIN_SECRET and NEW_ADMIN_ACTION_CHAIN_SECRET\n" +
        "  separately. Whatever you choose here must match what the deployed\n" +
        "  app has as IMPERSONATION_CHAIN_SECRET / ADMIN_ACTION_CHAIN_SECRET.",
    );
  }

  /*
    A short secret is worse than none, because it looks like protection: the
    console would report the log as keyed. 32 characters is the floor; the
    generator above produces 64.
  */
  if (value.length < 32) {
    fail(
      `The new secret for ${name} is only ${value.length} characters. Use at least 32.\n` +
        "An HMAC key short enough to brute-force is worse than no key, because\n" +
        "the console would report the log as keyed.",
    );
  }

  return value;
}

const NEW_IMPERSONATION = newSecretFor(
  "impersonation_sessions",
  process.env.NEW_IMPERSONATION_CHAIN_SECRET,
);
const NEW_ADMIN = newSecretFor(
  "admin_actions",
  process.env.NEW_ADMIN_ACTION_CHAIN_SECRET,
);

/* The old secrets, read exactly as the app reads them. Empty means unkeyed. */
const OLD_IMPERSONATION = process.env.IMPERSONATION_CHAIN_SECRET || null;
const OLD_ADMIN = process.env.ADMIN_ACTION_CHAIN_SECRET || null;

/** Report a verification the way the console would, minus the styling. */
function describe(label: string, v: ChainVerification): void {
  console.log(
    `  ${label}: ${v.ok ? "OK" : "FAILED"} — ${v.verified} verified, ` +
      `${v.legacyUnverified} pre-chain, ${v.total} total` +
      (v.firstBreak ? `\n    first break: ${v.firstBreak.detail}` : ""),
  );
}

/**
 * Re-hash one chain.
 *
 * The decisions all live in lib/rekey-chain.ts, which is pure and tested. This
 * function is the IO around them: read the rows, print the plan, write it.
 */
async function rekey<R extends RekeyableRow>(
  name: string,
  rows: R[],
  verify: (rows: readonly R[], secret: string | null) => ChainVerification,
  genesis: (secret: string | null) => string,
  rowHash: (row: R, prevHash: string, secret: string | null) => string,
  oldSecret: string | null,
  newSecret: string,
  write: (id: number, prevHash: string, hash: string) => Promise<void>,
): Promise<void> {
  console.log(`\n${name}`);
  console.log(`  rows: ${rows.length}`);
  describe("before (old secret)", verify(rows, oldSecret));

  const plan = planRekey({ rows, oldSecret, newSecret, verify, genesis, rowHash });

  if (!plan.ok) {
    if (plan.reason === "not_verified") {
      fail(
        `REFUSING to re-hash ${name}: it does not verify under the current secret.\n\n` +
          `  ${plan.detail}\n\n` +
          "Re-hashing now would overwrite the evidence of this break with hashes\n" +
          "that verify perfectly, turning a log that is telling you something into\n" +
          "one that looks pristine. Investigate the break first.",
      );
    }
    fail(`REFUSING to re-hash ${name} (${plan.reason}): ${plan.detail}`);
  }

  console.log(`  chained rows to rewrite: ${plan.writes.length}`);
  console.log(`  pre-chain rows left untouched: ${plan.untouched}`);
  describe("after  (new secret, simulated)", plan.after);

  if (plan.writes.length === 0) {
    console.log("  nothing to write.");
    return;
  }

  if (!WRITE) {
    console.log("  DRY RUN — nothing written. Re-run with --write to commit.");
    return;
  }

  /*
    Written in id order, one statement per row.

    neon-http gives no interactive transaction, so this is not atomic: an
    interruption leaves a prefix rewritten and the rest not, and the console
    would report the log broken at the boundary. That is recoverable — running
    this again with the same secret finishes the job, because the guard above
    is evaluated against the OLD secret and a half-rewritten chain fails it.
    Which is why the recovery is "run it again with the same NEW_CHAIN_SECRET
    as both old and new", not "run it again blind".
  */
  for (const w of plan.writes) {
    await write(w.id, w.chainPrevHash, w.chainHash);
  }
  console.log(`  written: ${plan.writes.length} rows.`);
}

/**
 * Which database this is actually pointed at.
 *
 * ── WHY THIS IS PRINTED, AND WHY IT IS PRINTED FIRST ──
 * The first real run of this script reported "rows: 0, nothing to write" and
 * looked like a clean success. It had connected to the DEVELOPMENT branch,
 * because DATABASE_URL comes from .env.local and that is what .env.local
 * points at. ALLOW_PRODUCTION_DB=1 was set, which lifts the safety guard but
 * does not change the destination — an easy thing to assume it does.
 *
 * A rekey that silently does nothing is the worst possible outcome for this
 * tool: production is left unkeyed while the app has been redeployed expecting
 * a key, so the console reports the chain broken and the operator believes the
 * job is done. Naming the host makes "rows: 0" self-diagnosing.
 *
 * Host and database only. The connection string carries a password and this
 * output is meant to be pasted into a chat while asking whether it looks right.
 */
function target(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "(DATABASE_URL not set)";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  console.log(
    WRITE
      ? "REKEY — WRITING. The audit chains will be rewritten under the new secret."
      : "REKEY — dry run. Nothing will be written.",
  );
  console.log(`  database:      ${target()}`);
  console.log(
    `  DATABASE_ENV:  ${process.env.DATABASE_ENV ?? "(not set)"}` +
      (process.env.DATABASE_ENV === "development"
        ? "   <-- this is a DEV database. Production rows will NOT be touched."
        : ""),
  );

  const sessions = await db
    .select({
      id: impersonationSessions.id,
      adminId: impersonationSessions.adminId,
      adminEmail: impersonationSessions.adminEmail,
      adminClerkUserId: impersonationSessions.adminClerkUserId,
      workspaceId: impersonationSessions.workspaceId,
      workspaceName: impersonationSessions.workspaceName,
      reason: impersonationSessions.reason,
      startedAt: impersonationSessions.startedAt,
      chainPrevHash: impersonationSessions.chainPrevHash,
      chainHash: impersonationSessions.chainHash,
    })
    .from(impersonationSessions)
    .orderBy(asc(impersonationSessions.id));

  await rekey<ImpersonationChainRow>(
    "impersonation_sessions",
    sessions,
    verifyImpersonationChain,
    impersonationGenesisHash,
    (row, prevHash, secret) => impersonationRowHash(row, prevHash, secret),
    OLD_IMPERSONATION,
    NEW_IMPERSONATION,
    async (id, prevHash, hash) => {
      await db
        .update(impersonationSessions)
        .set({ chainPrevHash: prevHash, chainHash: hash })
        .where(eq(impersonationSessions.id, id));
    },
  );

  const actions = await db
    .select()
    .from(adminActions)
    .orderBy(asc(adminActions.id));

  await rekey<AdminActionChainRow>(
    "admin_actions",
    actions as AdminActionChainRow[],
    verifyAdminActionChain,
    adminActionGenesisHash,
    (row, prevHash, secret) => adminActionRowHash(row, prevHash, secret),
    OLD_ADMIN,
    NEW_ADMIN,
    async (id, prevHash, hash) => {
      await db
        .update(adminActions)
        .set({ chainPrevHash: prevHash, chainHash: hash })
        .where(eq(adminActions.id, id));
    },
  );

  console.log(
    WRITE
      ? "\nDone. Confirm in the admin console: both chains should read intact, and keyed."
      : "\nDry run complete. Nothing was written.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
