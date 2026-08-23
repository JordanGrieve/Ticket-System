"use client";

import { Icon } from "./icons";
import type { ContactCard } from "./types";
import ContactNotes from "./ContactNotes";
import SharedLinks from "./SharedLinks";
import type { ContactNoteDTO } from "@/app/(dashboard)/queries";
import type { SharedLink } from "@/lib/shared-links";

/**
 * The 290px contact rail — a bottom sheet below 768px.
 *
 * Be warned reading this: much of the design's rail still has no data behind
 * it. Name, email, first contact, ticket count and NOTES are real. Phone
 * number, lifecycle status and the four disclosure sections are not stored
 * anywhere, so they render as explicit "not recorded" / "not built" states
 * rather than plausible-looking filler.
 */

/*
 * What is left of the design's disclosure rows, and why only one remains.
 *
 * "Shared links" left on 23 Aug 2026 — derived from message bodies now
 * (lib/shared-links.ts) rather than waiting on a table.
 *
 * "Documentation" was DELETED the same day, not built. Nobody could say what it
 * would hold against a CONTACT: the business's own help articles? files the
 * customer sent (that is Shared files)? internal process notes (that is Notes)?
 * A disabled row labelled "soon" is a promise, and keeping one nobody can
 * define made the rows beside it less believable.
 *
 * "Additional info" was FOLDED INTO NOTES, also not built. The plausible
 * reading was per-contact custom fields — "Allergy", "Usual order" — which is a
 * real feature and a large one: field definitions per workspace, types,
 * validation, ordering, a settings screen. A free-text note already holds
 * "gluten free, usually orders Thursday", and it is where people were going to
 * type it anyway. If a client asks for structure, that is the moment to build
 * fields, not before.
 *
 * "Shared files" stays because it is honestly unbuilt rather than undefined: it
 * is blocked on the attachments subsystem and cannot be faked from anything.
 */
const UNBUILT_SECTIONS = ["Shared files"];

function formatFirstSeen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ContactRail({
  contact,
  state,
  onClose,
  notes,
  addNote,
  deleteNote,
  links,
}: {
  contact: ContactCard;
  /** "auto" = column on a wide screen, hidden below 1180px. See Thread.tsx. */
  state: "auto" | "open" | "closed";
  onClose: () => void;
  /**
   * Omitted by the loading skeletons, which render this rail with no server
   * actions to hand. Notes show a loading line there rather than an empty box
   * somebody might type into and lose.
   */
  notes?: ContactNoteDTO[];
  addNote?: (formData: FormData) => void;
  deleteNote?: (formData: FormData) => void;
  /** Also omitted by the skeletons, which have no messages to derive from. */
  links?: SharedLink[];
}) {
  const firstSeen = formatFirstSeen(contact.firstSeenIso);

  return (
    <>
      <div
        className="pbm-rail-scrim"
        data-rail={state}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="pbm-rail pb-scroll"
        data-rail={state}
        aria-label="Contact details"
      >
        <div className="pbm-rail-grip" aria-hidden />
        <div className="pbm-rail-head">
          <h2 className="pbm-rail-title">General info</h2>
          <button className="pbm-rail-close" onClick={onClose} aria-label="Hide contact details">
            <Icon name="close" size={12} strokeWidth={2.4} />
          </button>
        </div>

        <div className="pbm-rail-card">
          <div>
            <p className="pbm-rail-name">{contact.name}</p>
            <p className="pbm-rail-void">No phone number on file</p>
          </div>
          <Field label="Email" value={contact.email} />
          <Field
            label="First contact"
            value={firstSeen}
            fallback="Not recorded — this contact predates contact tracking"
          />
          <Field
            label="Tickets"
            value={`${contact.ticketCount} in this workspace`}
          />
          <div>
            <p className="pbm-rail-label">Status</p>
            <p className="pbm-rail-void">
              Customer lifecycle status isn&rsquo;t tracked yet
            </p>
          </div>
        </div>

        {notes && addNote && deleteNote ? (
          <ContactNotes
            contactEmail={contact.email}
            notes={notes}
            onAdd={addNote}
            onDelete={deleteNote}
          />
        ) : (
          <>
            {/*
              The rail is also rendered by the loading skeletons, which have no
              server actions to hand. Notes are omitted there rather than shown
              as an empty list somebody might type into.
            */}
            <h3 className="pbm-rail-title pbm-rail-title--sub">Notes</h3>
            <div className="pbm-rail-card pbm-rail-card--empty">
              <p className="pbm-rail-void">Loading notes…</p>
            </div>
          </>
        )}

        {links && <SharedLinks links={links} />}

        <div className="pbm-rail-sections">
          {UNBUILT_SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="pbm-rail-row"
              disabled
              title={`${s} isn't available yet.`}
            >
              <span>{s}</span>
              <span className="pbm-rail-soon">soon</span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

function Field({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null;
  fallback?: string;
}) {
  return (
    <div>
      <p className="pbm-rail-label">{label}</p>
      {value ? (
        <p className="pbm-rail-value">{value}</p>
      ) : (
        <p className="pbm-rail-void">{fallback ?? "Not recorded"}</p>
      )}
    </div>
  );
}
