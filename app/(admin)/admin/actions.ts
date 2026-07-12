"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, ADMIN_WS_COOKIE } from "@/lib/viewer";
import { addAdmin, findAdminByEmail } from "@/lib/admin";
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

/** Pick a client to work within: remember it in a cookie, then open its inbox. */
export async function selectWorkspaceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("workspaceId"));
  if (!Number.isInteger(id)) redirect("/admin");

  const store = await cookies();
  store.set(ADMIN_WS_COOKIE, String(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/");
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

  await deleteWorkspace(id);

  // If the admin was acting inside this workspace, clear the selection.
  const store = await cookies();
  if (store.get(ADMIN_WS_COOKIE)?.value === String(id)) {
    store.delete(ADMIN_WS_COOKIE);
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
