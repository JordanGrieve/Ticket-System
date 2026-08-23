"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, contactNotes } from "@/db/schema";
import { resolveViewer } from "@/lib/viewer";
import { checkNote, normaliseContactEmail } from "@/lib/contact-notes";

/**
 * Internal notes on a customer.
 *
 * ── EVERY EXPORT HERE IS A PUBLIC POST ENDPOINT ──
 * A "use server" module's exports are callable by anyone who can guess the
 * action id, with whatever arguments they like. So nothing below trusts the
 * form: the workspace is re-resolved from the session on every call and never
 * read from the request, and the tenancy predicate goes INSIDE the mutating
 * statement rather than into a check performed before it. A delete that reads
 * the note first and then deletes by id is both a TOCTOU gap and, if the id
 * belongs to another workspace, a cross-tenant delete.
 *
 * Reads are NOT here, deliberately: an exported read taking a workspace id
 * would be a public read of any tenant's notes. Same rule as
 * app/(dashboard)/settings/team/queries.ts, which explains it at length.
 */

/** The workspace to write into, and how to attribute the note. */
async function requireAuthor(): Promise<{
  workspaceId: number;
  agentId: number | null;
  label: string;
} | null> {
  const viewer = await resolveViewer();
  if (!viewer.workspace) return null;

  // The agent row for this person IN THIS WORKSPACE. A Postbox operator acting
  // inside a client has no such row, which is why the id is nullable and why
  // the label below is stored regardless.
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, viewer.workspace.id),
        sql`lower(${agents.email}) = ${viewer.email.trim().toLowerCase()}`,
      ),
    )
    .limit(1);

  return {
    workspaceId: viewer.workspace.id,
    agentId: agent?.id ?? null,
    // Snapshot. Never recomputed, so a note keeps saying who wrote it even
    // after that person leaves or changes their address.
    label: viewer.email,
  };
}

export async function addContactNoteAction(formData: FormData): Promise<void> {
  const author = await requireAuthor();
  if (!author) return;

  const email = normaliseContactEmail(
    String(formData.get("contactEmail") ?? ""),
  );
  const check = checkNote(String(formData.get("body") ?? ""));
  if (!email || !check.ok) return;

  await db.insert(contactNotes).values({
    workspaceId: author.workspaceId,
    contactEmail: email,
    authorAgentId: author.agentId,
    authorLabel: author.label,
    body: check.body,
  });

  revalidatePath("/tickets", "layout");
}

export async function deleteContactNoteAction(
  formData: FormData,
): Promise<void> {
  const author = await requireAuthor();
  if (!author) return;

  const id = Number(formData.get("noteId"));
  if (!Number.isInteger(id) || id <= 0) return;

  // Tenancy inside the statement: an id from another workspace matches no row
  // and deletes nothing.
  await db
    .delete(contactNotes)
    .where(
      and(
        eq(contactNotes.id, id),
        eq(contactNotes.workspaceId, author.workspaceId),
      ),
    );

  revalidatePath("/tickets", "layout");
}
