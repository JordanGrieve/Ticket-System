"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminRow, ADMIN_WS_COOKIE } from "@/lib/viewer";
import { addAdmin, findAdminByEmail, getAdminById, removeAdmin } from "@/lib/admin";
import {
  ADMIN_IMP_COOKIE,
  endImpersonation,
  endOpenSessionsForAdmin,
  endOpenSessionsForWorkspace,
  startImpersonation,
} from "@/lib/impersonation";
import {
  getAgentByEmail,
  getWorkspaceById,
  deleteWorkspace,
  getPendingAgent,
} from "@/lib/data";
import { provisionWorkspace, INVITE_PREFIX } from "@/lib/workspace";
import { sendInviteEmail } from "@/lib/email";
import { APP_URL, EMAIL_FROM_ADDRESS } from "@/lib/config";
import { isValidEmail } from "@/lib/http";

function inviteToken(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return (
    INVITE_PREFIX +
    Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

/**
 * Server Actions run as untrusted POST endpoints, so every one re-checks the
 * caller is an admin via requireAdmin() before doing anything.
 */

const IMP_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
} as const;

/**
 * Pick a client to work within, and open the audit record for doing so.
 *
 * The order matters: the impersonation_sessions row is written FIRST and the
 * cookies only afterwards. If the audit write fails we bail out without
 * setting anything, because an operator inside a client workspace with no row
 * naming them is the exact situation this exists to prevent. It fails closed —
 * but only on the recording, never on the permission: who may impersonate is
 * unchanged.
 */
export async function selectWorkspaceAction(formData: FormData): Promise<void> {
  const admin = await requireAdminRow();
  const id = Number(formData.get("workspaceId"));
  if (!Number.isInteger(id)) redirect("/admin");

  const workspace = await getWorkspaceById(id);
  if (!workspace) redirect("/admin?error=That workspace no longer exists.");

  // Optional and free-text. Empty stays empty — a blank reason is recorded as
  // "none given", not padded out with a plausible one.
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  let sessionId: number;
  try {
    sessionId = await startImpersonation({ admin, workspace, reason });
  } catch {
    redirect(
      `/admin?account=${id}&error=${encodeURIComponent(
        "Couldn't open the access record, so you were not let in. Impersonation is only permitted when it can be logged — try again.",
      )}`,
    );
  }

  const store = await cookies();
  store.set(ADMIN_WS_COOKIE, String(id), IMP_COOKIE_OPTS);
  store.set(ADMIN_IMP_COOKIE, String(sessionId), IMP_COOKIE_OPTS);
  redirect("/inbox");
}

/**
 * Leave the client workspace and close the audit row. Called from the banner
 * that sits over the tenant dashboard, so this is the one exit an operator can
 * always reach from wherever they are.
 *
 * endOpenSessionsForAdmin runs as well as endImpersonation: it sweeps up rows
 * left open by an earlier abandoned visit in another browser or tab, which the
 * cookie alone knows nothing about.
 */
export async function stopImpersonatingAction(): Promise<void> {
  const admin = await requireAdminRow();

  const store = await cookies();
  const sessionId = Number(store.get(ADMIN_IMP_COOKIE)?.value);
  if (Number.isInteger(sessionId)) {
    await endImpersonation(sessionId, "stopped");
  }
  await endOpenSessionsForAdmin(admin.id, "stopped");

  store.delete(ADMIN_WS_COOKIE);
  store.delete(ADMIN_IMP_COOKIE);
  redirect("/admin?section=access");
}

/**
 * Onboard a new client: create their workspace now with a pending INVITE_
 * agent. When someone signs up with the matching email, resolveWorkspace
 * connects them to this workspace (instead of provisioning a blank one).
 */
export async function createClientAction(formData: FormData): Promise<void> {
  const adminEmail = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!name) redirect("/admin?error=Client name is required.");
  if (!isValidEmail(email)) redirect("/admin?error=A valid client email is required.");

  // An admin can't also be a client, and one email = one workspace.
  if (await findAdminByEmail(email)) {
    redirect("/admin?error=That email belongs to a Postbox admin.");
  }
  if (await getAgentByEmail(email)) {
    redirect("/admin?error=That email is already linked to a workspace.");
  }

  await provisionWorkspace({ name, ownerEmail: email, clerkUserId: inviteToken() });

  // Best-effort invite email — the workspace exists either way, and the
  // banner tells the admin whether the client was emailed.
  const invite = await sendInviteEmail({
    to: email,
    businessName: name,
    signUpUrl: `${APP_URL}/sign-up`,
    from: EMAIL_FROM_ADDRESS,
    inviterEmail: adminEmail,
  });

  revalidatePath("/admin");
  redirect(
    `/admin?created=${encodeURIComponent(name)}&emailed=${invite.sent ? "1" : "0"}`,
  );
}

/**
 * Remove a fellow admin. You can never remove yourself — which also
 * guarantees at least one admin always remains.
 */
export async function removeAdminAction(formData: FormData): Promise<void> {
  const selfEmail = await requireAdmin();

  const id = Number(formData.get("adminId"));
  if (!Number.isInteger(id)) redirect("/admin?error=Invalid admin.");

  const target = await getAdminById(id);
  if (!target) redirect("/admin?error=That admin no longer exists.");
  if (target.email === selfEmail) {
    redirect("/admin?error=You can't remove your own admin access.");
  }

  // They may be sitting inside a client right now. Their access ends with this
  // click, so the audit row has to end here too — a moment later the admins row
  // is gone and nothing points at their open session any more. The log rows
  // survive the delete (admin_id goes null, admin_email is frozen).
  await endOpenSessionsForAdmin(id, "admin_removed");
  await removeAdmin(id);
  revalidatePath("/admin");
  redirect(`/admin?removed=${encodeURIComponent(target.email)}`);
}

/** Re-send the sign-up invitation for a client who hasn't joined yet. */
export async function resendInviteAction(formData: FormData): Promise<void> {
  const adminEmail = await requireAdmin();

  const id = Number(formData.get("workspaceId"));
  if (!Number.isInteger(id)) redirect("/admin?error=Invalid workspace.");

  const workspace = await getWorkspaceById(id);
  if (!workspace) redirect("/admin?error=That workspace no longer exists.");

  const pending = await getPendingAgent(id);
  if (!pending) {
    redirect("/admin?error=That client has already signed in — nothing to resend.");
  }

  const invite = await sendInviteEmail({
    to: pending.email,
    businessName: workspace.name,
    signUpUrl: `${APP_URL}/sign-up`,
    from: EMAIL_FROM_ADDRESS,
    inviterEmail: adminEmail,
  });

  redirect(
    `/admin?created=${encodeURIComponent(workspace.name)}&emailed=${invite.sent ? "1" : "0"}`,
  );
}

/**
 * Permanently delete a client workspace — double-confirmed: the admin must
 * first click Delete (opens the confirm panel), then type the workspace's
 * exact name. Everything in it (tickets, messages, contacts, agents) is
 * erased by cascade. The client's login itself remains in Clerk; if they sign
 * in again they'd start a fresh blank workspace.
 */
export async function deleteClientAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = Number(formData.get("workspaceId"));
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  if (!Number.isInteger(id)) redirect("/admin?error=Invalid workspace.");

  const workspace = await getWorkspaceById(id);
  if (!workspace) redirect("/admin?error=That workspace no longer exists.");

  // Second confirmation: the typed name must match exactly.
  if (confirmName !== workspace.name) {
    redirect(
      `/admin?delete=${id}&error=${encodeURIComponent(
        "The name you typed didn't match — nothing was deleted.",
      )}`,
    );
  }

  // Before the delete, not after: the audit rows' workspace_id is "set null"
  // so they outlive the workspace, and once it is null there is nothing left
  // to match an open session on.
  await endOpenSessionsForWorkspace(id, "workspace_deleted");

  await deleteWorkspace(id);

  // If any admin was acting inside this workspace, clear the selection.
  const store = await cookies();
  if (store.get(ADMIN_WS_COOKIE)?.value === String(id)) {
    store.delete(ADMIN_WS_COOKIE);
    store.delete(ADMIN_IMP_COOKIE);
  }

  revalidatePath("/admin");
  redirect(`/admin?deleted=${encodeURIComponent(workspace.name)}`);
}

/** Grant super-admin to another email (a collaborator who can help clients). */
export async function addAdminAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (isValidEmail(email)) {
    await addAdmin(email);
  }
  revalidatePath("/admin");
}
