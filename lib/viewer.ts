import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import type { Workspace } from "@/db/schema";
import {
  findAdminByEmail,
  findAdminByClerkId,
  linkAdminClerkId,
} from "./admin";
import { getAgentByClerkId, getWorkspaceById } from "./data";
import { resolveWorkspace } from "./workspace";

/**
 * The signed-in viewer. Two roles:
 *  - "client": a tenant. Always bound to exactly one workspace (their own).
 *  - "admin":  a Postbox operator. Not bound to a workspace — instead they
 *    pick a client to "act within", remembered in a cookie. `workspace` is
 *    that selection, or null when they haven't chosen one yet.
 *
 * Both roles then flow through the same dashboard UI scoped to `workspace`,
 * so admins get the full inbox/reply/settings experience for any client.
 */
export type Viewer =
  | { isAdmin: true; email: string; workspace: Workspace | null }
  | {
      isAdmin: false;
      email: string;
      workspace: Workspace;
      agentEmail: string;
    };

/** Cookie holding the workspace id an admin is currently viewing. */
export const ADMIN_WS_COOKIE = "pb_admin_ws";

function primaryEmail(
  user: Awaited<ReturnType<typeof currentUser>>,
): string {
  return (
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    ""
  ).toLowerCase();
}

async function selectedAdminWorkspace(): Promise<Workspace | null> {
  const store = await cookies();
  const raw = store.get(ADMIN_WS_COOKIE)?.value;
  const id = raw ? Number(raw) : NaN;
  if (!Number.isInteger(id)) return null;
  return getWorkspaceById(id);
}

export const resolveViewer = cache(_resolveViewer);

async function _resolveViewer(): Promise<Viewer> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Fast path 1 — a known admin (Clerk id already linked). No Clerk API call.
  const adminById = await findAdminByClerkId(userId);
  if (adminById) {
    return {
      isAdmin: true,
      email: adminById.email,
      workspace: await selectedAdminWorkspace(),
    };
  }

  // Fast path 2 — a returning client (existing agent). No Clerk API call.
  // Any agent here is genuinely a client: admins promoted from a client are
  // pre-linked by addAdmin, so they'd have matched fast path 1 above.
  const agent = await getAgentByClerkId(userId);
  if (agent) {
    const workspace = await getWorkspaceById(agent.workspaceId);
    if (workspace) {
      return {
        isAdmin: false,
        email: agent.email,
        workspace,
        agentEmail: agent.email,
      };
    }
  }

  // Slow path — first sign-in (or an admin who hasn't logged in yet). Only now
  // do we pay for a Clerk API call to read the email.
  const user = await currentUser();
  const email = primaryEmail(user);

  const admin = email ? await findAdminByEmail(email) : null;
  if (admin) {
    if (!admin.clerkUserId) await linkAdminClerkId(admin.id, userId);
    return { isAdmin: true, email, workspace: await selectedAdminWorkspace() };
  }

  // Regular tenant: claim the demo seed or provision a fresh workspace.
  const { workspace, agent: newAgent } = await resolveWorkspace();
  return { isAdmin: false, email, workspace, agentEmail: newAgent.email };
}

/**
 * The workspace the current request should operate on:
 *  - client → their own workspace
 *  - admin  → their selected client, or null if none chosen yet
 * Shared by dashboard pages and the authed API routes.
 */
export async function activeWorkspace(): Promise<Workspace | null> {
  const viewer = await resolveViewer();
  return viewer.workspace;
}

/**
 * Guard for admin-only server code (layout + Server Actions, which are
 * untrusted POST entry points). Redirects non-admins away; returns the email.
 */
export async function requireAdmin(): Promise<string> {
  const viewer = await resolveViewer();
  if (!viewer.isAdmin) redirect("/");
  return viewer.email;
}
