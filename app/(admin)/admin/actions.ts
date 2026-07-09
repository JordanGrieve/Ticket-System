"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, ADMIN_WS_COOKIE } from "@/lib/viewer";
import { addAdmin } from "@/lib/admin";
import { isValidEmail } from "@/lib/http";

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
