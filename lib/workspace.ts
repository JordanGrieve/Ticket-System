import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces, agents, type Workspace, type Agent } from "@/db/schema";
import { INBOUND_DOMAIN } from "./config";

const SEED_PLACEHOLDER = "SEED_PLACEHOLDER";

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
 * Returns the workspace for the signed-in user, creating one if needed.
 *
 * Onboarding logic, in order:
 *  1. Existing agent → their workspace.
 *  2. Unclaimed demo seed → claim it (so the first login sees sample data).
 *  3. Otherwise → provision a fresh workspace + agent.
 *
 * Throws if there is no authenticated user (callers run behind auth).
 */
export const resolveWorkspace = cache(_resolveWorkspace);

async function _resolveWorkspace(): Promise<ResolvedWorkspace> {
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
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "owner@example.com";

  // 2. Claim the demo seed if it's still unclaimed.
  const seedAgent = await db
    .select()
    .from(agents)
    .where(eq(agents.clerkUserId, SEED_PLACEHOLDER))
    .limit(1);

  if (seedAgent.length > 0) {
    const [claimed] = await db
      .update(agents)
      .set({ clerkUserId: userId, email })
      .where(eq(agents.id, seedAgent[0].id))
      .returning();
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, claimed.workspaceId))
      .limit(1);
    return { workspace, agent: claimed };
  }

  // 3. Provision a brand-new workspace.
  const name =
    user?.firstName || user?.username
      ? `${user?.firstName ?? user?.username}'s workspace`
      : "My workspace";
  const base = slugify(name);
  const inboundEmail = `${base}-${randomHex(3)}@${INBOUND_DOMAIN}`;

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name,
      apiKey: generateApiKey(),
      inboundEmail,
      sendingEmail: email,
      accent: "terracotta",
    })
    .returning();

  const [agent] = await db
    .insert(agents)
    .values({ workspaceId: workspace.id, clerkUserId: userId, email })
    .returning();

  return { workspace, agent };
}
