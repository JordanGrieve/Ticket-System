"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminRow, ADMIN_WS_COOKIE } from "@/lib/viewer";
import { recordAdminAction } from "@/lib/admin-audit";
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
  rotateWorkspaceApiKey,
  setSignupConfirmation,
} from "@/lib/data";
import { provisionWorkspace, generateApiKey, INVITE_PREFIX } from "@/lib/workspace";
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
  // These two cookies gate entry into a client's data. Off in development so
  // http://localhost still works; on everywhere else, so they are never sent
  // over plaintext.
  secure: process.env.NODE_ENV === "production",
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
  // The row, not just the email: an audit entry has to name a specific
  // operator id rather than whatever address was on the session.
  const actor = await requireAdminRow();
  const adminEmail = actor.email;

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

  /*
    Logged BEFORE the mutation and fail-closed — see lib/admin-audit.ts. For a
    creation the asymmetry barely matters; it is written this way so all four
    actions read the same, because the one where it matters enormously is the
    delete below and a log with two different conventions is one somebody
    reasons about wrongly under pressure.
  */
  await recordAdminAction({
    action: "workspace_created",
    actorAdminId: actor.id,
    actorEmail: actor.email,
    targetLabel: name,
    detail: `owner ${email}`,
  });

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
  const actor = await requireAdminRow();
  const selfEmail = actor.email;

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
  await recordAdminAction({
    action: "admin_revoked",
    actorAdminId: actor.id,
    actorEmail: actor.email,
    targetId: target.id,
    targetLabel: target.email,
  });

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
  const actor = await requireAdminRow();

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

  /*
    The row this whole table exists for. Written BEFORE the delete and
    fail-closed, because deleteWorkspace cascades away every ticket, message,
    label and subscriber this client had, and once it has run there is no
    workspace row left to name.

    targetLabel is a snapshot for that reason, and admin_actions deliberately
    has NO foreign key to workspaces — the cascade this schema uses elsewhere
    would delete the record OF the deletion, which is precisely the entry
    somebody would come looking for.
  */
  await recordAdminAction({
    action: "workspace_deleted",
    actorAdminId: actor.id,
    actorEmail: actor.email,
    targetId: workspace.id,
    targetLabel: workspace.name,
    detail: workspace.inboundEmail,
  });

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

/**
 * Replace a client's public ingestion key.
 *
 * ── WHY THIS IS HERE AND NOT ON THE CLIENT'S OWN PAGE ──
 * It was on the Install page: one button, no role check, offered to every team
 * member a client invites, and irreversible. What it costs is their live
 * contact form, which goes on posting to a dead key until somebody edits their
 * website — the failure the ingestion route calls "THE bakery case", which ran
 * for six weeks before anyone noticed. What it protects is close to nothing:
 * the key authorises POSTing a ticket or a signup, cannot read a single row,
 * and ships in the client's own page source by design.
 *
 * So it is a repair for abuse we can see and they cannot, and the re-install
 * afterwards has to be arranged by someone who knows it is coming. Jordan,
 * 14 Sep 2026: "this should be our call, no? not theirs."
 *
 * The new key goes back in the redirect on purpose. It is not a secret — it is
 * about to be pasted into a public web page — and the operator needs to hand
 * it to whoever is doing the re-install.
 */
export async function rotateKeyAction(formData: FormData): Promise<void> {
  const actor = await requireAdminRow();

  const id = Number(formData.get("workspaceId"));
  if (!Number.isInteger(id)) redirect("/admin?error=Invalid workspace.");

  const workspace = await getWorkspaceById(id);
  if (!workspace) redirect("/admin?error=That workspace no longer exists.");

  // Same shape of confirmation as the delete: the name, typed. Both actions
  // break something at the client's end that they did not ask for, and this is
  // the one that looks harmless in a list of buttons.
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  if (confirmName !== workspace.name) {
    redirect(
      `/admin?rotate=${id}&error=${encodeURIComponent(
        "The name you typed didn't match — the key was not changed.",
      )}`,
    );
  }

  const updated = await rotateWorkspaceApiKey(workspace.id, generateApiKey());
  if (!updated) redirect("/admin?error=That workspace no longer exists.");

  /*
    Recorded AFTER the rotation, unlike the delete above, and the difference is
    deliberate: a delete destroys the row the record names, so it has to be
    written while there is still something to name. Here the workspace survives
    and the thing worth recording is that the key actually changed — logging an
    intention that then failed would put a rotation in the log that never
    happened, and send somebody hunting for a re-install nobody needs.

    The old key is not stored. It is dead, it identifies nothing, and writing
    it down would only make the log a list of keys.
  */
  await recordAdminAction({
    action: "workspace_key_rotated",
    actorAdminId: actor.id,
    actorEmail: actor.email,
    targetId: workspace.id,
    targetLabel: workspace.name,
    detail: `new key ${updated.apiKey}`,
  });

  revalidatePath("/admin");
  redirect(
    `/admin?account=${workspace.id}&rotated=${encodeURIComponent(
      workspace.name,
    )}&key=${encodeURIComponent(updated.apiKey)}`,
  );
}

/**
 * Switch a client between single and double opt-in for newsletter signups.
 *
 * ── WHY AN OPERATOR AND NOT THE CLIENT ──
 * Single opt-in is the default and it is what a client wants: no confirmation
 * click, so nobody is lost between the form and their inbox. What it risks is
 * not theirs. Campaigns for every workspace leave under one sending domain, so
 * a list filling with typos, bots and addresses a stranger typed produces the
 * bounces and complaints that degrade delivery for everybody else. The party
 * that pays is the platform, so the switch belongs to the platform.
 *
 * No typed confirmation. Unlike the rotate and the delete this breaks nothing
 * and is reversible in one click, in both directions — and a confirmation
 * ritual on a harmless control is how people learn to type past the ones that
 * matter.
 */
export async function setOptInAction(formData: FormData): Promise<void> {
  const actor = await requireAdminRow();

  const id = Number(formData.get("workspaceId"));
  if (!Number.isInteger(id)) redirect("/admin?error=Invalid workspace.");

  const workspace = await getWorkspaceById(id);
  if (!workspace) redirect("/admin?error=That workspace no longer exists.");

  // The checkbox's value, read as the state being MOVED TO rather than as a
  // toggle. A form that posts "flip it" races itself: two clicks on a slow
  // connection land as two flips and the operator gets back what they started
  // with, having been told twice that it changed.
  const required = String(formData.get("required") ?? "") === "1";

  const updated = await setSignupConfirmation(workspace.id, required);
  if (!updated) redirect("/admin?error=That workspace no longer exists.");

  // After the write, like the rotation: what is worth recording is that the
  // setting actually moved. Both states are named in the detail, because "off"
  // alone reads differently depending on what somebody assumes the default is.
  await recordAdminAction({
    action: "workspace_optin_changed",
    actorAdminId: actor.id,
    actorEmail: actor.email,
    targetId: workspace.id,
    targetLabel: workspace.name,
    detail: required
      ? "signups now require a confirmation link (double opt-in)"
      : "signups now subscribe immediately (single opt-in)",
  });

  revalidatePath("/admin");
  redirect(`/admin?account=${workspace.id}&optin=${required ? "double" : "single"}`);
}

/** Grant super-admin to another email (a collaborator who can help clients). */
export async function addAdminAction(formData: FormData): Promise<void> {
  const actor = await requireAdminRow();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (isValidEmail(email)) {
    // Inside the guard on purpose: an invalid address grants nothing, and
    // logging the attempt would fill the record with typos and bury the
    // entries that actually changed who can reach every client's data.
    await recordAdminAction({
      action: "admin_granted",
      actorAdminId: actor.id,
      actorEmail: actor.email,
      targetLabel: email,
    });
    await addAdmin(email);
  }
  revalidatePath("/admin");
}
