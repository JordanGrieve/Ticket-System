import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { workspaces, agents, type Workspace, type Agent } from "@/db/schema";
import { INBOUND_DOMAIN, OPEN_SIGNUP } from "./config";

/**
 * Placeholder clerkUserId prefixes for agents whose human hasn't signed in yet.
 *  - SEED_…   demo workspaces created by db/seed scripts
 *  - INVITE_… client workspaces created by an admin from /admin
 * A signer whose email matches a placeholder agent claims that workspace on
 * first login (see resolveWorkspace). Never claimed by email mismatch.
 */
export const INVITE_PREFIX = "INVITE_";

export function isPlaceholderClerkId(clerkUserId: string): boolean {
  return clerkUserId.startsWith("SEED_") || clerkUserId.startsWith(INVITE_PREFIX);
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "workspace"
  );
}

export function generateApiKey(): string {
  return `cli_${randomHex(16)}`;
}

export type ResolvedWorkspace = { workspace: Workspace; agent: Agent };

/**
 * Creates a workspace + its first agent row. Used by self-serve sign-up (real
 * clerkUserId) and by the admin "add client" flow (INVITE_… placeholder that
 * the client claims on first sign-in).
 */
export async function provisionWorkspace(input: {
  name: string;
  ownerEmail: string;
  clerkUserId: string;
}): Promise<ResolvedWorkspace> {
  const base = slugify(input.name);
  const inboundEmail = `${base}-${randomHex(3)}@${INBOUND_DOMAIN}`;
  const email = input.ownerEmail.trim().toLowerCase();

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: input.name,
      apiKey: generateApiKey(),
      inboundEmail,
      sendingEmail: email,
      accent: "terracotta",
    })
    .returning();

  const [agent] = await db
    .insert(agents)
    .values({ workspaceId: workspace.id, clerkUserId: input.clerkUserId, email })
    .returning();

  return { workspace, agent };
}

/**
 * Returns the workspace for the signed-in user, or null when they have none
 * and may not create one (invite-only mode).
 *
 * Onboarding logic, in order:
 *  1. Existing agent → their workspace.
 *  2. A placeholder agent (admin invite or demo seed) whose email matches the
 *     signer's email → claim that workspace. Email must match: a stranger can
 *     never claim someone else's invite or the demo data.
 *  3. Otherwise: OPEN_SIGNUP=true → provision a fresh workspace (self-serve);
 *     default → null (invite-only — the caller shows /no-access).
 *
 * Throws if there is no authenticated user (callers run behind auth).
 */
export const resolveWorkspace = cache(_resolveWorkspace);

async function _resolveWorkspace(): Promise<ResolvedWorkspace | null> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // 1. Existing membership.
  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.clerkUserId, userId))
    .limit(1);

  if (existing.length > 0) {
    const agent = existing[0];
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, agent.workspaceId))
      .limit(1);
    return { workspace, agent };
  }

  const user = await currentUser();
  const email = (
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "owner@example.com"
  )
    .trim()
    .toLowerCase();

  // 2. Claim a pending invite (or demo seed) that was prepared for this email.
  const invited = await db
    .select()
    .from(agents)
    .where(
      sql`lower(${agents.email}) = ${email} AND (${or(
        like(agents.clerkUserId, "SEED_%"),
        like(agents.clerkUserId, `${INVITE_PREFIX}%`),
      )})`,
    )
    .limit(1);

  if (invited.length > 0) {
    const [claimed] = await db
      .update(agents)
      .set({ clerkUserId: userId, email })
      .where(eq(agents.id, invited[0].id))
      .returning();
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, claimed.workspaceId))
      .limit(1);
    return { workspace, agent: claimed };
  }

  // 3. No invite. Invite-only (default): no workspace — never hand strangers
  // a tenant (it includes sending email from our domain). Self-serve only
  // when explicitly enabled.
  if (!OPEN_SIGNUP) return null;

  const name =
    user?.firstName || user?.username
      ? `${user?.firstName ?? user?.username}'s workspace`
      : "My workspace";

  return provisionWorkspace({ name, ownerEmail: email, clerkUserId: userId });
}
