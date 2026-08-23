"use client";

import { useRef } from "react";
import type { ContactNoteDTO } from "@/app/(dashboard)/queries";
import { MAX_NOTE_LENGTH } from "@/lib/contact-notes";

/**
 * Internal notes about a customer, in the contact rail.
 *
 * ── THIS IS ALSO WHERE "ADDITIONAL INFO" WENT ──
 * The design had a separate disclosure row for it. Folded in here on 23 August
 * 2026 rather than built, because the plausible reading — per-contact custom
 * fields, "Allergy", "Usual order" — is a large feature (field definitions per
 * workspace, types, validation, ordering, a settings screen) and a free-text
 * note already holds "gluten free, usually orders Thursday". If a client asks
 * for structure, that is the moment to build fields. The copy below carries
 * examples for that reason: it is the only place those facts can live now, and
 * a box labelled "add a note" does not say so.
 *
 * ── THESE ARE NEVER SHOWN TO THE CUSTOMER ──
 * Said on the screen, not just in a comment, because staff will write things
 * here they would not put in a reply. It is also not the whole truth and the
 * screen does not pretend otherwise: a note is staff writing about a named
 * person, which is personal data, and a subject access request reaches it.
 * "Internal" means the product does not show it to them; it does not mean
 * nobody ever will.
 *
 * ── A CLIENT COMPONENT FOR ONE REASON ──
 * The form needs to clear itself after a successful submit, which needs a ref.
 * Everything else is plain form posts to server actions — no fetch, no local
 * copy of the list, no optimistic state to get out of step with the database.
 * The actions revalidate and the server sends the new list.
 */
export default function ContactNotes({
  contactEmail,
  notes,
  onAdd,
  onDelete,
}: {
  contactEmail: string;
  notes: ContactNoteDTO[];
  /** Server action: addContactNoteAction */
  onAdd: (formData: FormData) => void;
  /** Server action: deleteContactNoteAction */
  onDelete: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <h3 className="pbm-rail-title pbm-rail-title--sub">Notes</h3>

      <form
        ref={formRef}
        className="pbn-form"
        action={(formData) => {
          onAdd(formData);
          // Optimistic only about the TEXTAREA, never about the list. If the
          // action refuses the note the box is empty and the note is gone,
          // which is annoying; a list that shows a note the database rejected
          // is worse, because somebody relies on it being there.
          formRef.current?.reset();
        }}
      >
        <input type="hidden" name="contactEmail" value={contactEmail} />
        {/*
          The placeholder carries an example, not just an instruction.
          "Additional info" was folded into this box on 23 Aug 2026 rather than
          built as custom fields, so this is now the only place a per-customer
          fact like an allergy or a usual order can live — and an empty box
          labelled "add a note" does not suggest that. A concrete example is
          what tells somebody the box is for more than "rang her Tuesday".
        */}
        <textarea
          className="pbn-input"
          name="body"
          rows={2}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Allergies, usual order, what you agreed on the phone…"
          aria-label="Add a note about this customer"
        />
        <button className="pbn-add" type="submit">
          Save note
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="pbm-rail-void">
          Nothing noted about this customer yet. Anything you write here — a
          dietary requirement, what they usually order, what was agreed on a
          call — is for your team only. The customer never sees it.
        </p>
      ) : (
        <ul className="pbn-list">
          {notes.map((n) => (
            <li className="pbn-item" key={n.id}>
              {/*
                Rendered as text, never as HTML. Staff type into this box and
                whatever they type is shown back to other staff; treating it as
                markup would make the notes field a stored-XSS hole aimed at
                the people who can read every customer's messages.
              */}
              <p className="pbn-body">{n.body}</p>
              <p className="pbn-meta">
                <span>{n.authorLabel}</span>
                <span aria-hidden> · </span>
                <time dateTime={n.createdAtIso}>
                  {formatNoteDate(n.createdAtIso)}
                </time>
                <form action={onDelete} className="pbn-del-form">
                  <input type="hidden" name="noteId" value={n.id} />
                  <button
                    className="pbn-del"
                    type="submit"
                    aria-label="Delete this note"
                  >
                    Delete
                  </button>
                </form>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Date only, no clock.
 *
 * A time would be rendered on the client from a UTC instant and could disagree
 * with the server's idea of it across a midnight boundary; the day is what
 * anybody reading a note actually wants, and it is stable.
 */
function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
