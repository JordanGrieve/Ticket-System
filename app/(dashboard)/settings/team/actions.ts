"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { resolveViewer } from "@/lib/viewer";
import { getAgentByEmail } from "@/lib/data";
import { INVITE_PREFIX } from "@/lib/workspace";
import { sendInviteEmail } from "@/lib/email";
import { APP_URL, EMAIL_FROM_ADDRESS } from "@/lib/config";
import { checkInvite, checkRevoke } from "@/lib/team";
import { listTeam } from "./queries";

/**
 * Team management for a CLIENT workspace.
 *
 * ── SERVER ACTIONS ARE UNTRUSTED POST ENDPOINTS ──
 * Same discipline as app/(admin)/admin/actions.ts: every action re-resolves the
 * viewer and re-reads the team from the database before deciding anything.
 * Nothing is trusted from the form except the email string and the target id,
 * and the target id is checked against the caller's OWN team — so an id
 * belonging to another workspace finds no match and deletes nothing.
 *
 * ── THE INVITE IS CLAIMED BY EMAIL ──
 * There is no token. lib/workspace.ts matches a placeholder row by address on
 * first sign-in, which means the address is the credential and a typo grants a
 * stranger a client's customer mail. The rules that guard that live in
 * lib/team.ts, where they are tested.
 */

function inviteToken(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return (
    INVITE_PREFIX +
    Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

/** The caller's workspace and their own agent row, or a redirect. */
async function requireClient() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  return viewer;
}

// Reads live in ./queries.ts, NOT here. Every export from a "use server"
// module is a callable POST endpoint, so an exported read taking a workspace
// id would be a public read of any tenant’s team. See that file.
const readTeam = listTeam;

function back(error?: string, notice?: string): never {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (notice) params.set("notice", notice);
  const qs = params.toString();
  revalidatePath("/settings/team");
  redirect(qs ? `/settings/team?${qs}` : "/settings/team");
}

export async function inviteTeammateAction(formData: FormData): Promise<void> {
  const viewer = await requireClient();
  const workspace = viewer.workspace!;

  const raw = String(formData.get("email") ?? "");
  const team = await readTeam(workspace.id);

  // Is this address an agent ANYWHERE? Asked across all workspaces on purpose:
  // the claim matches by email, so the same address in two workspaces means
  // the first sign-in claims whichever row the query returns first.
  const existing = await getAgentByEmail(raw.trim().toLowerCase());

  const check = checkInvite({
    email: raw,
    team,
    existingAnywhere: existing !== null,
  });
  if (!check.ok) back(check.error);

  await db.insert(agents).values({
    workspaceId: workspace.id,
    email: check.email,
    clerkUserId: inviteToken(),
  });

  // Best effort, and the invite stands either way — the row IS the invite, so
  // a failed email means "resend it", not "the person was not invited". Said
  // plainly in the notice rather than reported as success.
  const sent = await sendInviteEmail({
    to: check.email,
    businessName: workspace.name,
    signUpUrl: `${APP_URL.replace(/\/$/, "")}/sign-up`,
    from: EMAIL_FROM_ADDRESS,
    inviterEmail: viewer.email,
  }).catch((err) => {
    console.error("[team] invite email failed:", err);
    return { sent: false } as const;
  });

  back(
    undefined,
    sent.sent
      ? `Invited ${check.email}. They'll get an email with a link to sign in.`
      : `Added ${check.email}, but the invite email couldn't be sent. Tell them to sign in at ${APP_URL}/sign-up with that address.`,
  );
}

export async function revokeTeammateAction(formData: FormData): Promise<void> {
  const viewer = await requireClient();
  const workspace = viewer.workspace!;

  const targetId = Number(formData.get("agentId"));
  if (!Number.isInteger(targetId)) back("That person isn’t on your team.");

  const team = await readTeam(workspace.id);
  const self = team.find(
    (m) => m.email.toLowerCase() === viewer.email.toLowerCase(),
  );

  const check = checkRevoke({
    targetId,
    // -1 when the viewer has no agent row of their own — an operator inside a
    // client workspace by impersonation. They are not on the team, so the
    // "can't remove yourself" rule cannot apply to them, and the remaining
    // rules still do.
    selfId: self?.id ?? -1,
    team,
  });
  if (!check.ok) back(check.error);

  // The workspace predicate is INSIDE the delete, not a check above it. Same
  // rule as every other mutating statement here: a check-then-write can be
  // raced, and this one deletes access to customer data.
  const removed = await db
    .delete(agents)
    .where(and(eq(agents.id, targetId), eq(agents.workspaceId, workspace.id)))
    .returning({ email: agents.email });

  if (removed.length === 0) back("That person isn’t on your team.");

  console.info(
    "[team] %s removed %s from workspace %d",
    viewer.email,
    removed[0].email,
    workspace.id,
  );
  back(undefined, `Removed ${removed[0].email}.`);
}


