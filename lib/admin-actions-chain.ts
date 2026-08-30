import {
  chainGenesis,
  chainRowHash,
  verifyHashChain,
  type ChainVerification,
} from "./hash-chain";
import type { AdminActionKind } from "@/db/schema";

/**
 * The hash chain over admin_actions.
 *
 * ── WHY THIS LOG NEEDED IT MORE THAN THE OTHER ONE ──
 * impersonation_sessions was chained first because it answers a client's
 * question about who read their customers' messages. admin_actions records
 * something worse: an operator DELETING a client workspace, which cascades
 * away every ticket, message, label and subscriber they had.
 *
 * Leaving it unchained while the viewing log was chained meant the more
 * serious of the two records was the easier one to erase quietly. Somebody
 * holding DATABASE_URL could delete a client and then delete the row saying
 * they had.
 *
 * ── EVERY COLUMN IS COVERED, UNLIKE THE OTHER CHAIN ──
 * impersonation_sessions has a mutable tail — lastSeenAt, endedAt,
 * endedReason are written after the insert, so the chain cannot cover them and
 * an operator can still relabel how a session ended.
 *
 * Nothing in admin_actions is ever updated. The row is written once, before
 * the mutation it describes, and never touched again. So the chain covers the
 * whole row and there is no equivalent caveat to make.
 *
 * Pure, like lib/impersonation-chain.ts, so it is testable with no
 * DATABASE_URL. The IO half lives in lib/admin-audit.ts.
 */

/**
 * Domain separation. Different from the impersonation chain's tag on purpose:
 * a row lifted from one table must not verify against the other's chain.
 */
export const ADMIN_ACTION_CHAIN_DOMAIN = "postbox.admin-actions-chain.v1";

/** The environment variable that keys this chain. */
export const ADMIN_CHAIN_SECRET_ENV = "ADMIN_ACTION_CHAIN_SECRET";

/** The fields covered, in hash order. Every column the table has. */
export const ADMIN_CHAINED_FIELDS = [
  "action",
  "actorAdminId",
  "actorEmail",
  "targetId",
  "targetLabel",
  "detail",
  "createdAt",
] as const;

/** The subset of an admin_actions row the chain reads. */
export type AdminActionChainRow = {
  id: number;
  action: AdminActionKind;
  actorAdminId: number | null;
  actorEmail: string;
  targetId: number | null;
  targetLabel: string | null;
  detail: string | null;
  createdAt: Date | string;
  chainPrevHash: string | null;
  chainHash: string | null;
};

export type AdminActionChainContent = Omit<
  AdminActionChainRow,
  "id" | "chainPrevHash" | "chainHash"
>;

/**
 * Timestamps hash as millisecond-precision UTC ISO text.
 *
 * Postgres timestamptz carries MICROseconds and a JS Date does not, so a row
 * hashed from a Date and re-read later would disagree with itself on digits
 * nobody can see. The writer truncates created_at to milliseconds for exactly
 * this reason — same arrangement, and the same trap, as the other chain.
 */
function isoMillis(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

function parts(content: AdminActionChainContent): unknown[] {
  return [
    content.action,
    content.actorAdminId,
    content.actorEmail,
    content.targetId,
    content.targetLabel,
    content.detail,
    isoMillis(content.createdAt),
  ];
}

export function adminActionRowHash(
  content: AdminActionChainContent,
  prevHash: string,
  secret: string | null,
): string {
  return chainRowHash(
    ADMIN_ACTION_CHAIN_DOMAIN,
    parts(content),
    prevHash,
    secret,
  );
}

export function adminActionGenesisHash(secret: string | null): string {
  return chainGenesis(ADMIN_ACTION_CHAIN_DOMAIN, secret);
}

export function verifyAdminActionChain(
  rows: readonly AdminActionChainRow[],
  secret: string | null = null,
): ChainVerification {
  return verifyHashChain(rows, {
    domain: ADMIN_ACTION_CHAIN_DOMAIN,
    secret,
    hashOf: (row, prevHash) => adminActionRowHash(row, prevHash, secret),
    noun: "Action",
    editableFields: "operator, target or timestamp",
    writer: "recordAdminAction",
    secretEnvName: ADMIN_CHAIN_SECRET_ENV,
  });
}

/**
 * One line for an operator. Its own wording rather than a shared helper:
 * "3 recorded actions verify against each other" is not the sentence the
 * impersonation log wants, and a generic version says "rows", which is what a
 * database says rather than what a person asks about.
 */
export function describeAdminChain(v: ChainVerification): string {
  const keyNote = v.keyed
    ? ""
    : " (unkeyed: this detects accidents and careless edits, not a " +
      "deliberate rewrite)";
  const legacy =
    v.legacyUnverified > 0
      ? ` ${v.legacyUnverified} older action${
          v.legacyUnverified === 1 ? "" : "s"
        } predate the chain and cannot be verified either way.`
      : "";

  if (!v.firstBreak) {
    return `${v.verified} recorded action${
      v.verified === 1 ? "" : "s"
    } verify against each other${keyNote}.${legacy}`;
  }

  return `Chain breaks at action #${v.firstBreak.id} (row ${
    v.firstBreak.index + 1
  } of ${v.total}): ${v.firstBreak.detail}${legacy}`;
}
