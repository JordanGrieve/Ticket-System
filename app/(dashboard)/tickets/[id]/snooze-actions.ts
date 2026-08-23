"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import {
  archiveTicket,
  unarchiveTicket,
  snoozeTicket,
  unsnoozeTicket,
} from "@/lib/snooze-store";
import { isValidSnoozeMinutes } from "@/lib/snooze";

/**
 * Archive, snooze, and their undos.
 *
 * ── EVERY EXPORT HERE IS A PUBLIC POST ENDPOINT ──
 * A "use server" module's exports are callable by anyone who can guess the
 * action id, with any arguments. So the workspace is re-resolved from the
 * session every time and never read from the request, and the tenancy
 * predicate lives INSIDE the mutating statement rather than in a check
 * performed beforehand. Same posture as trash-actions.ts beside this.
 *
 * ── NOTHING HERE HIDES ANYTHING PERMANENTLY ──
 * Archive is reversible from the Archived folder. Snooze reverses ITSELF when
 * its time arrives, because the state is derived from `snoozed_until > now()`
 * rather than stored — there is no job that has to run for a ticket to come
 * back. See db/schema.ts.
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

export async function archiveTicketAction(formData: FormData): Promise<void> {
  const viewer = await requireWorkspace();
  const ticketId = ticketIdFrom(formData);
  if (!ticketId) return;

  await archiveTicket({ workspaceId: viewer.workspace!.id, ticketId });

  revalidatePath("/inbox", "layout");
  redirect("/inbox?folder=inbox");
}

export async function unarchiveTicketAction(formData: FormData): Promise<void> {
  const viewer = await requireWorkspace();
  const ticketId = ticketIdFrom(formData);
  if (!ticketId) return;

  await unarchiveTicket({ workspaceId: viewer.workspace!.id, ticketId });

  revalidatePath("/inbox", "layout");
  // Back to the ticket, not to the Archived list it has just left — returning
  // somebody to a list their ticket is no longer in reads as the action having
  // failed. Same reasoning as restoreTicketAction.
  redirect(`/tickets/${ticketId}`);
}

export async function snoozeTicketAction(formData: FormData): Promise<void> {
  const viewer = await requireWorkspace();
  const ticketId = ticketIdFrom(formData);
  if (!ticketId) return;

  const minutes = Number(formData.get("minutes"));
  // Validated here AND in the store. This is a public endpoint, so the value
  // is attacker-controlled: a negative interval would set a wake time in the
  // past and the button would appear to do nothing at all.
  if (!isValidSnoozeMinutes(minutes)) return;

  await snoozeTicket({
    workspaceId: viewer.workspace!.id,
    ticketId,
    minutes,
    // An email SNAPSHOT, not an agent id — see tickets.snoozedBy. An id goes
    // null when a teammate leaves, and "snoozed by nobody" is the wrong answer
    // to "why did this vanish from our inbox for a week?".
    snoozedBy: viewer.email,
  });

  revalidatePath("/inbox", "layout");
  redirect("/inbox?folder=inbox");
}

export async function unsnoozeTicketAction(formData: FormData): Promise<void> {
  const viewer = await requireWorkspace();
  const ticketId = ticketIdFrom(formData);
  if (!ticketId) return;

  await unsnoozeTicket({ workspaceId: viewer.workspace!.id, ticketId });

  revalidatePath("/inbox", "layout");
  redirect(`/tickets/${ticketId}`);
}
