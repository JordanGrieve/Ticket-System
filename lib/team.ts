/**
 * Who else can get into this workspace — the rules half.
 *
 * Pure: no database, no network. The IO lives in the server actions beside the
 * screen. Every rule below is a way somebody loses access to their own inbox,
 * or gains access to somebody else's, so they are worth proving without a
 * deployment.
 *
 * ── WHAT AN INVITE ACTUALLY IS ──
 * A row in `agents` with a placeholder `clerk_user_id` (INVITE_…) and the
 * invitee's email. lib/workspace.ts claims it on first sign-in by matching the
 * email, case-insensitively. There is no token and no expiry: the email address
 * IS the credential.
 *
 * That is worth saying plainly, because it sets the security model. Whoever can
 * sign in with that address gets this workspace — so a typo does not fail, it
 * grants a stranger access to a client's customer mail. Hence
 * `describeInviteRisk` below, and hence the screen asks for confirmation
 * rather than inviting on one click.
 *
 * NOTE the placeholder test (isPlaceholderClerkId) deliberately stays in
 * lib/workspace.ts and is NOT re-exported here. Importing it would pull
 * db/index.ts in transitively and this file would stop being testable without
 * a DATABASE_URL — the same boundary that took /inbox down when lib/config.ts
 * was reached from a client bundle. The caller does the classifying and passes
 * `pending` in.
 */

export type TeamMember = {
  id: number;
  email: string;
  /** Placeholder clerk id — invited, never signed in. */
  pending: boolean;
};

export type InviteCheck =
  | { ok: true; email: string }
  | { ok: false; error: string };

/** Upper bound on a workspace's team. Not a licence tier — a blast radius. */
export const MAX_TEAM_SIZE = 10;

/**
 * May this address be invited to this workspace?
 *
 * `existingAnywhere` is the answer to "does an agent row for this email exist
 * in ANY workspace". It matters because the claim is by email match: two rows
 * with the same address in different workspaces means the first sign-in claims
 * whichever the query happens to return first, which is a coin toss that
 * decides whose customer data somebody sees.
 */
export function checkInvite(input: {
  email: string;
  team: TeamMember[];
  existingAnywhere: boolean;
}): InviteCheck {
  const email = input.email.trim().toLowerCase();

  if (!email) return { ok: false, error: "Enter an email address." };
  if (email.length > 254 || !looksLikeEmail(email)) {
    return { ok: false, error: "That doesn’t look like an email address." };
  }

  if (input.team.some((m) => m.email.trim().toLowerCase() === email)) {
    return {
      ok: false,
      error: "That person is already on your team.",
    };
  }

  if (input.existingAnywhere) {
    // Deliberately vague to the client: whether an address belongs to another
    // workspace is not theirs to learn, and the honest specific version
    // ("they're already with another business") is a membership oracle.
    return {
      ok: false,
      error:
        "That address can’t be added. If it’s definitely right, get in touch and we’ll sort it out.",
    };
  }

  if (input.team.length >= MAX_TEAM_SIZE) {
    return {
      ok: false,
      error: `A workspace can have up to ${MAX_TEAM_SIZE} people. Remove somebody first.`,
    };
  }

  return { ok: true, email };
}

export type RevokeCheck = { ok: true } | { ok: false; error: string };

/**
 * May this member be removed?
 *
 * Two ways this goes wrong and both end with somebody locked out of their own
 * customer mail: removing yourself, and removing the last person.
 */
export function checkRevoke(input: {
  targetId: number;
  selfId: number;
  team: TeamMember[];
}): RevokeCheck {
  const target = input.team.find((m) => m.id === input.targetId);
  if (!target) return { ok: false, error: "That person isn’t on your team." };

  if (target.id === input.selfId) {
    // Not a technical limit — the row could be deleted. But somebody who
    // removes themselves is one click from having no way back in, and the
    // recovery path is "email the operator", which is not a feature.
    return {
      ok: false,
      error: "You can’t remove yourself. Ask someone else on the team to do it.",
    };
  }

  if (input.team.length <= 1) {
    return {
      ok: false,
      error: "Somebody has to be able to get in. Add another person first.",
    };
  }

  return { ok: true };
}

/**
 * What the client is agreeing to when they invite somebody.
 *
 * Rendered as a confirmation, not buried in help text. The invite grants full
 * access — there are no roles in this product — and it is claimed by email, so
 * the address being right is load-bearing.
 */
export function describeInviteRisk(email: string): string {
  return (
    `${email} will be able to read every message your customers send you, ` +
    `reply as your business, and change your settings. Anyone who can sign in ` +
    `with that address gets in, so check it carefully.`
  );
}

/** Sorted for display: real members first, then pending, each alphabetical. */
export function sortTeam(team: TeamMember[]): TeamMember[] {
  return [...team].sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? 1 : -1;
    return a.email.localeCompare(b.email);
  });
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
