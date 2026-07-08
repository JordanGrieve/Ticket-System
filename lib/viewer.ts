import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces, type Workspace } from "@/db/schema";
import { findAdminByEmail, linkAdminClerkId } from "./admin";
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
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return ws ?? null;
}

export const resolveViewer = cache(_resolveViewer);

async function _resolveViewer(): Promise<Viewer> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const user = await currentUser();
  const email = primaryEmail(user);

  const admin = email ? await findAdminByEmail(email) : null;
  if (admin) {
    // Record the Clerk id once (audit only) — never claim a workspace.
    if (!admin.clerkUserId) await linkAdminClerkId(admin.id, userId);
    return { isAdmin: true, email, workspace: await selectedAdminWorkspace() };
  }

  // Regular tenant: resolve (or provision) their single workspace.
  const { workspace, agent } = await resolveWorkspace();
  return { isAdmin: false, email, workspace, agentEmail: agent.email };
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
