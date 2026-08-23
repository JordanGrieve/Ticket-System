"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { moveTicketToTrash, restoreTicketFromTrash } from "@/lib/trash-store";

/**
 * Move a ticket to the trash, and take it back out.
 *
 * ── EVERY EXPORT HERE IS A PUBLIC POST ENDPOINT ──
 * A "use server" module's exports are callable by anyone who can guess the
 * action id, with any arguments. So the workspace is re-resolved from the
 * session every time and never read from the request, and the tenancy
 * predicate lives INSIDE the mutating statement rather than in a check
 * performed beforehand — on a delete, a check that a concurrent request can
 * invalidate means deleting somebody else's mail.
 *
 * ── NEITHER ACTION DESTROYS ANYTHING ──
 * Deleting sets a timestamp. The only thing that removes a ticket is
 * purgeExpiredTrash, 30 days later, from the daily sweep. That is deliberate:
 * this is customer correspondence, and no button a person can double-click
 * should be able to lose it.
 */

async function requireWorkspace() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  return viewer;
}

function ticketIdFrom(formData: FormData): number | null {
  const id = Number(formData.get("ticketId"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function trashTicketAction(formData: FormData): Promise<void> {
  const viewer = await requireWorkspace();
  const ticketId = ticketIdFrom(formData);
  if (!ticketId) return;

  await moveTicketToTrash({
    workspaceId: viewer.workspace!.id,
    ticketId,
    // An email SNAPSHOT, not an agent id — see tickets.deletedBy. An operator
    // acting inside the workspace has no agents row, and "deleted by nobody"
    // is the wrong answer to "who deleted our customer's enquiry?".
    deletedBy: viewer.email,
  });

  // The whole shell: folder counts in the nav change, and so does the list the
  // ticket has just left.
  revalidatePath("/inbox", "layout");
  redirect("/inbox?folder=inbox");
}

export async function restoreTicketAction(formData: FormData): Promise<void> {
  const viewer = await requireWorkspace();
  const ticketId = ticketIdFrom(formData);
  if (!ticketId) return;

  await restoreTicketFromTrash({
    workspaceId: viewer.workspace!.id,
    ticketId,
  });

  revalidatePath("/inbox", "layout");
  // Back to the restored ticket rather than to Trash: somebody who restores a
  // thread almost always wants to read or answer it, and returning them to a
  // list it is no longer in reads as the restore having failed.
  redirect(`/tickets/${ticketId}`);
}
