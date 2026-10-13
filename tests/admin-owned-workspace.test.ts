import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * An operator can own a workspace (13 Oct 2026). Before this the console
 * refused an admin's email outright. Three things have to hold for the
 * change to be more than a deleted guard:
 *
 *  1. the row an admin owns carries their real Clerk id when they have one,
 *     so the console does not report "Awaiting sign-in" for a sign-in that
 *     already happened;
 *  2. an admin who has never signed in gets a placeholder like anybody else,
 *     and the viewer claims it for them on first sign-in, because admins
 *     never reach resolveWorkspace where a client's invite is claimed;
 *  3. no invitation email goes to somebody already in the console.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }));
vi.mock("@/lib/rate-limit-store", () => ({ rateLimitDurable: vi.fn() }));
vi.mock("@/lib/labels", () => ({ seedStarterLabels: vi.fn() }));

const { ownerClerkId, INVITE_PREFIX } = await import("@/lib/workspace");

describe("ownerClerkId", () => {
  it("uses the admin's real Clerk id when they have signed in", () => {
    expect(ownerClerkId({ clerkUserId: "user_2abc" })).toBe("user_2abc");
  });

  it("falls back to a fresh invite placeholder for an admin who never has", () => {
    const a = ownerClerkId({ clerkUserId: null });
    const b = ownerClerkId({ clerkUserId: null });
    expect(a.startsWith(INVITE_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("gives anybody who is not an admin an invite placeholder", () => {
    expect(ownerClerkId(null).startsWith(INVITE_PREFIX)).toBe(true);
  });
});

describe("the console's create-workspace action", () => {
  const actions = readFileSync("app/(admin)/admin/actions.ts", "utf8");
  const viewer = readFileSync("lib/viewer.ts", "utf8");

  it("no longer refuses an admin's email", () => {
    expect(actions).not.toContain("belongs to a Postbox admin");
    expect(actions).toContain("ownerClerkId(ownerAdmin)");
  });

  it("still refuses an email that already has a workspace", () => {
    expect(actions).toContain("already linked to a workspace");
  });

  it("does not email an invitation to the operator who owns it", () => {
    const create = actions.slice(
      actions.indexOf("export async function createClientAction"),
      actions.indexOf("export async function", actions.indexOf("export async function createClientAction") + 1),
    );
    const guard = create.indexOf("if (ownerAdmin)");
    const invite = create.indexOf("sendInviteEmail(");
    expect(guard).toBeGreaterThan(-1);
    expect(invite).toBeGreaterThan(guard);
  });

  it("claims a waiting invite for an admin on their first sign-in", () => {
    const slowPath = viewer.slice(viewer.indexOf("const admin = email ? await findAdminByEmail(email)"));
    expect(slowPath).toContain("claimInviteForEmail(email, userId)");
  });
});
