/**
 * Internal notes about a customer — the rules half.
 *
 * Pure: no database, no network, so the limits can be proved without a
 * deployment. The IO lives beside the screen in
 * app/(dashboard)/tickets/[id]/note-actions.ts.
 *
 * These notes are INTERNAL. They are never rendered into an email, never shown
 * to the customer, and never leave the workspace. That is worth stating because
 * it is the assumption every other decision here rests on — and because the
 * body is written by staff about a named human being, which is personal data
 * under GDPR and subject to a subject access request. "Internal" means the
 * customer does not see it in the product; it does not mean they can never see
 * it. Say nothing in a note you would not defend having written.
 */

/** Longer than a sentence, shorter than an essay. */
export const MAX_NOTE_LENGTH = 2000;

export type NoteCheck =
  | { ok: true; body: string }
  | { ok: false; error: string };

/**
 * Is this note storable?
 *
 * Trims, then rejects empty. Trimming first matters: a textarea that has been
 * clicked into and out of yields "\n", and a list full of blank notes is how a
 * feature stops being used.
 */
export function checkNote(raw: string): NoteCheck {
  const body = raw.trim();
  if (!body) return { ok: false, error: "Write something first." };
  if (body.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `Notes are limited to ${MAX_NOTE_LENGTH} characters.`,
    };
  }
  return { ok: true, body };
}

/**
 * The identity a note is filed under.
 *
 * Lower-cased and trimmed to match `contacts.email`, which is stored the same
 * way and unique per workspace. Without this, "Emma@" and "emma@" file notes
 * about one person into two lists that nobody can reconcile — and the one you
 * see depends on the capitalisation of whichever email arrived most recently.
 *
 * Returns null rather than a bad key: an empty or malformed address should
 * write nothing at all, not create an orphan note nobody will ever see again.
 */
export function normaliseContactEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) return null;
  return email;
}

/**
 * How a note is attributed in the rail.
 *
 * `authorLabel` is a snapshot taken when the note was written, so it is always
 * present — including for notes written by a Postbox operator acting inside the
 * workspace, who has no agents row and would otherwise be indistinguishable
 * from a teammate who has since been removed.
 */
export function describeAuthor(authorLabel: string): string {
  return authorLabel.trim() || "Unknown";
}
