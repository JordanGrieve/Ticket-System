import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import type { Admin, ImpersonationSession, Workspace } from "@/db/schema";
import {
  findAdminByEmail,
  findAdminByClerkId,
  linkAdminClerkId,
} from "./admin";
import {
  ADMIN_IMP_COOKIE,
  getOpenSession,
  touchImpersonation,
} from "./impersonation";
import { getAgentByClerkId, getWorkspaceById } from "./data";
import { resolveWorkspace } from "./workspace";

/**
 * The signed-in viewer. Three states:
 *  - "admin":  a Postbox operator. Not bound to a workspace — instead they
 *    pick a client to "act within", remembered in a cookie. `workspace` is
 *    that selection, or null when they haven't chosen one yet.
 *  - "client": a tenant. Bound to exactly one workspace (their own).
 *  - uninvited: signed in, but no invite matched and self-serve sign-up is
 *    off — `workspace` is null and the UI shows /no-access.
 *
 * Admins and clients flow through the same dashboard UI scoped to
 * `workspace`, so admins get the full inbox/reply/settings experience for
 * any client.
 *
 * An admin with a `workspace` also carries `impersonation`: the open audit row
 * for this visit (lib/impersonation). It is null when the selection predates
 * the audit trail, or the row was closed under them — those visits still work,
 * because recording access must never be the thing that decides access, but
 * the banner says out loud that nothing is being written.
 */
export type Viewer =
  | {
      isAdmin: true;
      email: string;
      workspace: Workspace | null;
      impersonation: ImpersonationSession | null;
    }
  | {
      isAdmin: false;
      email: string;
      workspace: Workspace;
      agentEmail: string;
    }
  | { isAdmin: false; email: string; workspace: null };

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

/**
 * What an admin is currently pointed at: the client they picked, plus the
 * audit row covering it.
 *
 * ── ACCESS IS GRANTED BY THE AUDIT ROW, NOT BY THE COOKIE ──
 *
 * This previously returned `{ workspace, impersonation: null }` whenever the
 * session cookie was missing, closed, or mismatched — which meant a bare
 * `pb_admin_ws` cookie was sufficient to enter a tenant with nothing written to
 * impersonation_sessions. An operator could set it by hand in devtools, omit
 * the session cookie entirely, and read every customer's data unlogged. The
 * dashboard did render a red "not being recorded" banner, but API routes render
 * nothing at all, and GET /api/workspace/export is a complete JSON dump of a
 * tenant's tickets, messages and contacts. That is the exact gap this audit
 * trail exists to close, so the cookie can no longer stand alone.
 *
 * Now: no open, matching session row means no workspace. It fails closed on
 * RECORDING, never on permission — who is allowed to impersonate is unchanged,
 * and an admin who lands here simply gets bounced to /admin to re-enter through
 * the audited path, which writes a row.
 *
 * This also closes the log-poisoning variant: hand-editing pb_admin_ws to point
 * at a different workspace no longer grants access, because the open session
 * names the workspace it was opened for and the two must agree.
 *
 * ADMIN_IMP_COOKIE only *names* a row; the row is the record. A cookie naming a
 * session that is closed, missing, or belongs to another admin or workspace is
 * treated as no session at all rather than being believed.
 *
 * This is also where the heartbeat fires. resolveViewer runs on every dashboard
 * render and every authed API route, so an operator cannot touch a client's
 * data without moving `lastSeenAt` — which is what bounds the access window
 * when they never exit cleanly.
 */
async function selectedAdminWorkspace(adminId: number): Promise<{
  workspace: Workspace | null;
  impersonation: ImpersonationSession | null;
}> {
  const none = { workspace: null, impersonation: null };

  const store = await cookies();
  const raw = store.get(ADMIN_WS_COOKIE)?.value;
  const id = raw ? Number(raw) : NaN;
  if (!Number.isInteger(id)) return none;

  const workspace = await getWorkspaceById(id);
  if (!workspace) return none;

  const rawSession = store.get(ADMIN_IMP_COOKIE)?.value;
  const sessionId = rawSession ? Number(rawSession) : NaN;
  if (!Number.isInteger(sessionId)) return none;

  const session = await getOpenSession(sessionId);
  if (
    !session ||
    session.adminId !== adminId ||
    session.workspaceId !== workspace.id
  ) {
    return none;
  }

  await touchImpersonation(session.id);
  return { workspace, impersonation: session };
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
      ...(await selectedAdminWorkspace(adminById.id)),
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
    return {
      isAdmin: true,
      email,
      ...(await selectedAdminWorkspace(admin.id)),
    };
  }

  // Regular tenant: claim a matching invite, or (open sign-up only)
  // provision a fresh workspace. Null = uninvited → /no-access.
  const resolved = await resolveWorkspace();
  if (!resolved) return { isAdmin: false, email, workspace: null };
  return {
    isAdmin: false,
    email,
    workspace: resolved.workspace,
    agentEmail: resolved.agent.email,
  };
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
  if (!viewer.isAdmin) redirect("/inbox");
  return viewer.email;
}

/**
 * As requireAdmin, but hands back the whole admin row — needed wherever we
 * write an audit record, which has to name a specific operator id and not just
 * whatever email happened to be on the session.
 */
export async function requireAdminRow(): Promise<Admin> {
  const email = await requireAdmin();
  const admin = await findAdminByEmail(email);
  // Only reachable if the admin row vanished between resolveViewer and here.
  if (!admin) redirect("/inbox");
  return admin;
}

/**
 * Everything the impersonation banner needs, or null when the viewer is not an
 * operator inside a client workspace.
 *
 * `session` being null while this returns non-null is the unrecorded case: the
 * operator IS inside a client, and we are NOT writing it down. The banner must
 * say so rather than fall back to looking normal.
 */
export type ImpersonationContext = {
  workspace: Workspace;
  operatorEmail: string;
  session: ImpersonationSession | null;
};

export async function currentImpersonation(): Promise<ImpersonationContext | null> {
  const viewer = await resolveViewer();
  if (!viewer.isAdmin || !viewer.workspace) return null;
  return {
    workspace: viewer.workspace,
    operatorEmail: viewer.email,
    session: viewer.impersonation,
  };
}
