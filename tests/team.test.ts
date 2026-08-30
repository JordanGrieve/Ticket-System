import { describe, it, expect } from "vitest";
import {
  checkInvite,
  checkRevoke,
  describeInviteRisk,
  sortTeam,
  seatLimit,
  MAX_TEAM_SIZE,
  type TeamMember,
} from "../lib/team";

/**
 * Every rule here is a way somebody loses access to their own customer mail,
 * or gains access to somebody else's.
 *
 * The invite has no token and no expiry — lib/workspace.ts claims it by
 * matching the email address on first sign-in. The address IS the credential.
 * So a typo does not fail safe: it hands a stranger a client's inbox.
 */

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 1,
  email: "emma@opendoorbakery.com",
  pending: false,
  // Members by default. Tests that care about ownership say so explicitly,
  // so a new rule about owners cannot pass by accident on a fixture.
  role: "member",
  ...over,
});

const base = { team: [member()], existingAnywhere: false };

describe("who may be invited", () => {
  it("accepts a new address and normalises it", () => {
    const r = checkInvite({ ...base, email: "  NewStaff@Example.COM " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("newstaff@example.com");
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["no at sign", "notanemail"],
    ["no domain", "someone@"],
    ["too long", "a".repeat(250) + "@example.com"],
  ])("refuses a %s address", (_label, email) => {
    expect(checkInvite({ ...base, email }).ok).toBe(false);
  });

  it("refuses somebody already on the team, whatever the casing", () => {
    const r = checkInvite({ ...base, email: "EMMA@opendoorbakery.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already on your team/i);
  });

  it("refuses an address that belongs to another workspace", () => {
    // The claim is by email match. Two rows with the same address in different
    // workspaces means the first sign-in claims whichever the query returns
    // first — a coin toss deciding whose customer data somebody sees.
    const r = checkInvite({ ...base, email: "x@y.com", existingAnywhere: true });
    expect(r.ok).toBe(false);
  });

  it("does not tell the client WHY that address is unavailable", () => {
    // "They're already with another business" is a membership oracle: it lets
    // anyone with a login test which addresses use Postbox elsewhere.
    const r = checkInvite({ ...base, email: "x@y.com", existingAnywhere: true });
    if (!r.ok) {
      expect(r.error).not.toMatch(/another workspace|another business|already exists/i);
    }
  });

  it("caps the team size", () => {
    const team = Array.from({ length: MAX_TEAM_SIZE }, (_, i) =>
      member({ id: i + 1, email: `p${i}@example.com` }),
    );
    const r = checkInvite({ email: "one.more@example.com", team, existingAnywhere: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(new RegExp(String(MAX_TEAM_SIZE)));
  });
});

describe("who may be removed", () => {
  const emma = member({ id: 1, email: "emma@opendoorbakery.com", role: "owner" });
  const staff = member({ id: 2, email: "staff@opendoorbakery.com" });
  const second = member({ id: 3, email: "second@opendoorbakery.com" });

  it("the owner removes a teammate", () => {
    expect(checkRevoke({ targetId: 2, selfId: 1, team: [emma, staff] }).ok).toBe(true);
  });

  it("a MEMBER cannot remove anybody", () => {
    /*
     * Changed on 28 August. Removal used to be open to everyone and 'owner'
     * meant only "cannot be removed" — so somebody invited an hour ago could
     * remove the person who invited them, and every colleague besides.
     *
     * Everything else is still identical between the roles: a member reads
     * every message, replies as the business, changes settings and sends
     * newsletters. Removal is the one exception.
     */
    const r = checkRevoke({ targetId: 3, selfId: 2, team: [emma, staff, second] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/only the owner/i);
  });

  it("tells a member it is a permission problem, not a social one", () => {
    // A member removing themselves must not be told to "ask someone else on
    // the team to do it" — nobody below owner can, so that advice sends them
    // to a colleague who will also fail.
    const r = checkRevoke({ targetId: 2, selfId: 2, team: [emma, staff] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/only the owner/i);
  });

  it("refuses to let the OWNER remove themselves", () => {
    // The row could be deleted — this is not a technical limit. But somebody
    // who removes themselves is one click from no way back in, and the
    // recovery path is "email the operator", which is not a feature.
    const r = checkRevoke({ targetId: 1, selfId: 1, team: [emma, staff] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/can’t remove yourself/i);
  });

  it("keeps the empty-team guard even though nothing can now reach it", () => {
    /*
     * With removal restricted to the owner, and an owner able to remove
     * neither themselves nor another owner, every removal leaves at least the
     * owner behind — so team.length <= 1 is unreachable through the product.
     *
     * The check stays because it is free and because the thing it prevents is
     * a workspace holding customer mail that nobody can open. If roles ever
     * change again it is already there. Reached here by calling the rule with
     * a caller the new permission check lets through.
     */
    const soleOwner = member({ id: 1, role: "owner" });
    const r = checkRevoke({ targetId: 1, selfId: 1, team: [soleOwner] });
    expect(r.ok).toBe(false);
  });

  it("refuses an id that isn’t on this team", () => {
    // The server re-checks against the caller's OWN workspace team, so a
    // crafted id from another tenant lands here rather than deleting a row.
    expect(checkRevoke({ targetId: 999, selfId: 1, team: [emma, staff] }).ok).toBe(false);
  });
});

describe("what the client is told", () => {
  it("states the full extent of the access being granted", () => {
    // There are no roles in this product. An invite is total access, and the
    // confirmation has to say so rather than implying a limited one.
    const text = describeInviteRisk("new@example.com");
    expect(text).toContain("new@example.com");
    expect(text).toMatch(/every message/i);
    expect(text).toMatch(/reply as your business/i);
    expect(text).toMatch(/change your settings/i);
    // And that the address itself is the credential.
    expect(text).toMatch(/anyone who can sign in with that address/i);
  });
});

describe("display order", () => {
  it("puts people who have signed in above pending invites", () => {
    const sorted = sortTeam([
      member({ id: 1, email: "zoe@x.com", pending: true }),
      member({ id: 2, email: "amy@x.com", pending: false }),
      member({ id: 3, email: "bob@x.com", pending: false }),
    ]);
    expect(sorted.map((m) => m.email)).toEqual([
      "amy@x.com",
      "bob@x.com",
      "zoe@x.com",
    ]);
  });
});

describe("the owner cannot be removed by somebody else", () => {
  // There are no permission levels in this product: an invited teammate can do
  // everything the person who invited them can do. That is deliberate. What it
  // must not extend to is deleting the person whose business this is.
  //
  // And this is not a malicious-employee story. The invite is claimed by
  // whoever signs in with the address, so a mis-typed invite hands a stranger
  // full access — and before the role column, the ability to delete the owner
  // and keep the inbox.
  const owner = member({ id: 1, email: "emma@bakery.com", role: "owner" });
  const staff = member({ id: 2, email: "sam@bakery.com", role: "member" });

  it("refuses when a member tries to remove the owner", () => {
    const r = checkRevoke({ targetId: owner.id, selfId: staff.id, team: [owner, staff] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner/i);
  });

  it("still allows the owner to remove a member", () => {
    expect(
      checkRevoke({ targetId: staff.id, selfId: owner.id, team: [owner, staff] }).ok,
    ).toBe(true);
  });

  it("refuses even when the remover is another owner", () => {
    // Should not be reachable — the backfill and the default give exactly one
    // owner per workspace — but the rule must not depend on that holding.
    const second = member({ id: 3, email: "co@bakery.com", role: "owner" });
    expect(
      checkRevoke({ targetId: owner.id, selfId: second.id, team: [owner, second] }).ok,
    ).toBe(false);
  });

  it("says 'yourself' rather than 'owner' when the owner removes themselves", () => {
    // Both rules apply; the self rule is checked first and its message is the
    // more useful one, because it names the thing they actually did.
    const r = checkRevoke({ targetId: owner.id, selfId: owner.id, team: [owner, staff] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/yourself/i);
  });

  it("blames ownership, not team size, when the owner is the last person", () => {
    // Removing the only person also trips the last-person rule. The owner rule
    // is checked first on purpose: "add another person first" would be actively
    // misleading, since adding one would not make the removal allowed.
    const r = checkRevoke({ targetId: owner.id, selfId: staff.id, team: [owner] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner/i);
  });
});

describe("seats follow the plan, not one global constant", () => {
  // The pricing page sells 1 / 3 / 10 people. Before this, MAX_TEAM_SIZE was
  // 10 for everybody, so a Starter customer could invite nine colleagues —
  // a promise on the page taking money that the code taking it did not keep.
  const teamOf = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      member({ id: i + 1, email: `p${i}@bakery.com` }),
    );

  it("refuses a second person on a one-seat plan", () => {
    const r = checkInvite({
      email: "new@bakery.com",
      team: teamOf(1),
      existingAnywhere: false,
      planSeats: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 person/);
  });

  it("allows a second person on a three-seat plan", () => {
    expect(
      checkInvite({
        email: "new@bakery.com",
        team: teamOf(1),
        existingAnywhere: false,
        planSeats: 3,
      }).ok,
    ).toBe(true);
  });

  it("names the plan that would fit them", () => {
    // "Limit reached" is a dead end that produces a support email asking what
    // the limit is. Naming the next plan is something somebody can act on.
    const r = checkInvite({
      email: "new@bakery.com",
      team: teamOf(1),
      existingAnywhere: false,
      planSeats: 1,
      upgradeTo: { name: "Growth", seats: 3 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Growth/);
      expect(r.error).toMatch(/3/);
    }
  });

  it("does NOT suggest an upgrade that would not help", () => {
    // Telling somebody on the largest plan to upgrade is worse than saying
    // nothing: it sends them to a billing page that cannot solve their problem.
    const r = checkInvite({
      email: "new@bakery.com",
      team: teamOf(10),
      existingAnywhere: false,
      planSeats: 10,
      upgradeTo: { name: "Business", seats: 10 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/upgrade/i);
  });

  it("still refuses beyond MAX_TEAM_SIZE even if a plan claimed more", () => {
    // The absolute ceiling is a blast radius, not a licence tier: everyone in
    // a workspace can read every customer message and reply as the business.
    const r = checkInvite({
      email: "new@bakery.com",
      team: teamOf(MAX_TEAM_SIZE),
      existingAnywhere: false,
      planSeats: 500,
    });
    expect(r.ok).toBe(false);
  });

  it("fails OPEN to the ceiling when the plan cannot be resolved", () => {
    // A broken entitlement lookup must not stop a paying customer adding
    // their own staff. Worst case is one invite too many.
    expect(seatLimit(null)).toBe(MAX_TEAM_SIZE);
    expect(
      checkInvite({
        email: "new@bakery.com",
        team: teamOf(2),
        existingAnywhere: false,
        planSeats: null,
      }).ok,
    ).toBe(true);
  });

  it("refuses new invites when a downgrade left them over, but that is all", () => {
    // Downgrading Business (8 people) to Growth (3) is a state reached without
    // inviting anybody. checkInvite only ever refuses ADDING someone — there
    // is no path here that removes a person, because removing staff from a
    // shared inbox over a billing change is how a support desk loses its team
    // on a Monday morning. checkRevoke is the only remover and it is untouched.
    const over = teamOf(8);
    expect(
      checkInvite({
        email: "new@bakery.com",
        team: over,
        existingAnywhere: false,
        planSeats: 3,
      }).ok,
    ).toBe(false);

    // Everyone already there can still be removed deliberately by a human,
    // and nothing about the plan changes that.
    // The caller has to be the owner now; see "who may be removed".
    const overWithOwner = over.map((m, i) =>
      i === 0 ? { ...m, role: "owner" as const } : m,
    );
    expect(
      checkRevoke({ targetId: 2, selfId: 1, team: overWithOwner }).ok,
    ).toBe(true);
  });
});
