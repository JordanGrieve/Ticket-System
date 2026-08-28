import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { forms, workspaces, type Form, type Workspace } from "@/db/schema";
import { randomBytes } from "node:crypto";

/**
 * Named contact forms, and the key each one posts with.
 *
 * ── THE DECISION PIVOT 17 ASKED FOR: A KEY PER FORM ──
 * The task left it open — "separate keys are cleaner to revoke; one key is far
 * easier to install" — and the alternative was one workspace key plus a form
 * NAME in the request body. Three things settled it.
 *
 *  1. REVOCATION. A key is published in the client's page source by design.
 *     With one key, rotating it because one page was scraped takes down every
 *     form the business has. With a key per form, the blast radius is the form
 *     that had the problem.
 *
 *  2. THE PAYLOAD IS NOT A PLACE TO PUT IDENTITY. A form name in the body is a
 *     string anybody can change in their browser, and PIVOT 14 wants auto-reply
 *     rules to vary BY FORM. That would make which automated email a stranger
 *     receives depend on a field the stranger controls. A key is at least
 *     something we issued and can look up.
 *
 *  3. INSTALL COST IS SMALLER THAN IT LOOKS. The counter-argument is that a
 *     second form means a second key to paste. But somebody adding a second
 *     form is already editing a second page, and the install screen hands them
 *     the whole snippet with the key in it. They are pasting a snippet, not
 *     memorising a credential.
 *
 * ── THE WORKSPACE KEY KEEPS WORKING, FOREVER ──
 * Every existing installation posts to /api/tickets/<workspace key>, including
 * Open Door Bakery's, whose form was silently 401ing for six weeks earlier
 * this month for exactly this class of reason. Nothing here may repeat that.
 * So the workspace key resolves to "this workspace, no particular form" and a
 * form key resolves to "this workspace, this form" — additive, with no flag
 * day and nothing to migrate.
 *
 * A ticket taken through the workspace key therefore has a null form_id, which
 * is what db/schema.ts already says that column means.
 */

/** What a public ingestion key resolved to. */
export type IngestTarget = {
  workspace: Workspace;
  /** The named form, or null when the workspace-wide key was used. */
  form: Form | null;
};

/**
 * Resolve a public ingestion key to a workspace, and to a form if the key
 * belongs to one.
 *
 * ── ONE ROUND TRIP FOR THE COMMON CASE ──
 * The workspace key is tried first because it is what every installation in
 * existence uses today, and a form key only costs a second query for the
 * workspaces that have adopted them. Doing it the other way round would make
 * the common path slower to serve a case nobody is in yet.
 *
 * Returns null for an unknown key, and the caller MUST record that — a key
 * that stopped working is invisible to us otherwise, which is precisely how
 * the bakery's form failed for six weeks without anybody knowing.
 */
export async function resolveIngestKey(key: string): Promise<IngestTarget | null> {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.apiKey, key))
    .limit(1);
  if (ws) return { workspace: ws, form: null };

  /*
   * A form key. The join carries the workspace, so this stays one round trip
   * rather than a form lookup followed by a workspace lookup — same reasoning
   * as getAgentWithWorkspaceByClerkId in lib/data.ts, where the hop is the
   * cost rather than the query.
   */
  const rows = await db
    .select({ form: forms, workspace: workspaces })
    .from(forms)
    .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
    .where(eq(forms.key, key))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { workspace: row.workspace, form: row.form };
}

/** Every form a workspace has defined, oldest first. */
export async function listForms(workspaceId: number): Promise<Form[]> {
  return db
    .select()
    .from(forms)
    .where(eq(forms.workspaceId, workspaceId))
    .orderBy(asc(forms.id));
}

/**
 * A new ingestion key.
 *
 * Shaped like the workspace key so the two are indistinguishable to anyone
 * reading a page source, and long enough that guessing one is not a strategy.
 * `pbf_` marks it as a form key when it turns up in a log or a support
 * conversation, which is the only place the distinction has to be legible.
 */
export function newFormKey(): string {
  return `pbf_${randomBytes(18).toString("hex")}`;
}

/**
 * Create a named form with its own key.
 *
 * The name is trimmed and capped rather than validated into a shape: it is
 * shown in the dashboard and in the ticket list, never parsed, and a business
 * calling a form "Wholesale — trade only (not retail!)" is describing their
 * own shop correctly.
 */
export async function createForm(input: {
  workspaceId: number;
  name: string;
}): Promise<Form | null> {
  const name = input.name.trim().slice(0, 80);
  if (!name) return null;

  const [created] = await db
    .insert(forms)
    .values({
      workspaceId: input.workspaceId,
      name,
      key: newFormKey(),
    })
    .returning();

  return created ?? null;
}

/**
 * Rename a form.
 *
 * The workspace predicate is INSIDE the statement, not a check performed
 * first: a form id arrives from a request, and a check a concurrent request
 * can invalidate is not a check. Same rule as everything in lib/trash-store.ts.
 */
export async function renameForm(input: {
  workspaceId: number;
  formId: number;
  name: string;
}): Promise<boolean> {
  const name = input.name.trim().slice(0, 80);
  if (!name) return false;

  const res = await db
    .update(forms)
    .set({ name })
    .where(
      and(eq(forms.id, input.formId), eq(forms.workspaceId, input.workspaceId)),
    )
    .returning({ id: forms.id });

  return res.length > 0;
}

/**
 * Stop a form's key working, without deleting the form.
 *
 * ── REVOKE, NOT DELETE, AND THIS IS THE WHOLE POINT OF PER-FORM KEYS ──
 * Deleting the row would set form_id to null on every ticket that came through
 * it (the column is ON DELETE SET NULL), quietly rewriting the history of
 * where a year of enquiries came from. Clearing the key leaves that history
 * intact and makes exactly one thing stop: new submissions on that key.
 *
 * The form then reads as "not published" in the dashboard, which is the same
 * state a form has before it is first installed — one state, not two.
 */
export async function revokeFormKey(input: {
  workspaceId: number;
  formId: number;
}): Promise<boolean> {
  const res = await db
    .update(forms)
    .set({ key: null })
    .where(
      and(eq(forms.id, input.formId), eq(forms.workspaceId, input.workspaceId)),
    )
    .returning({ id: forms.id });

  return res.length > 0;
}

/** Issue a fresh key for a form whose old one was revoked or compromised. */
export async function regenerateFormKey(input: {
  workspaceId: number;
  formId: number;
}): Promise<string | null> {
  const key = newFormKey();
  const res = await db
    .update(forms)
    .set({ key })
    .where(
      and(eq(forms.id, input.formId), eq(forms.workspaceId, input.workspaceId)),
    )
    .returning({ id: forms.id });

  return res.length > 0 ? key : null;
}
