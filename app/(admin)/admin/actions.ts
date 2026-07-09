"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, ADMIN_WS_COOKIE } from "@/lib/viewer";
import { addAdmin, findAdminByEmail } from "@/lib/admin";
import { getAgentByEmail } from "@/lib/data";
import { provisionWorkspace, INVITE_PREFIX } from "@/lib/workspace";
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
  await requireAdmin();

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

  revalidatePath("/admin");
  redirect(`/admin?created=${encodeURIComponent(name)}`);
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
