"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import SheetGrip from "./SheetGrip";
import {
  decideSheetTouch,
  sheetOffset,
  shouldCloseOnRelease,
  type SheetTouch,
} from "@/lib/sheet-drag";
import type { ContactCard } from "./types";
import ContactNotes from "./ContactNotes";
import SharedLinks from "./SharedLinks";
import type { ContactNoteDTO } from "@/app/(dashboard)/queries";
import type { SharedLink } from "@/lib/shared-links";
import { detectEmailTypo, describeEmailTypo } from "@/lib/email-typo";

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
  /*
    How far the sheet has been dragged down, in px. Zero at rest.

    Held here rather than inside SheetGrip because the transform belongs to the
    <aside>: the handle owns the gesture, the sheet owns its own position. It
    is also why the transition is suppressed mid-drag — a sheet that eases
    toward your finger lags behind it, which reads as lag rather than polish.
  */
  const [dragY, setDragY] = useState(0);
  const asideRef = useRef<HTMLElement>(null);

  /*
    ── DRAGGING THE SHEET FROM ITS BODY, WITH A THUMB ──
    The grip above the title takes pointer events and works. It was also the
    ONLY thing that moved the sheet, and on a real phone nobody's thumb finds
    a 32px strip — it lands on the sheet, which is a scroller, so the pull
    scrolled (or, at the top, rubber-banded) and the sheet stayed put. That
    is "this is moveable on desktop but on my phone I can't do it".

    Raw touch listeners rather than pointer events, for one reason: the
    decision is CONDITIONAL. A pull is a scroll when there is content above
    and a drag when there is not, and `touch-action` cannot express that —
    it is static CSS. The only way to claim a touch by condition is to call
    preventDefault on its first touchmove, which needs a non-passive listener,
    which React's synthetic onTouchMove does not give. lib/sheet-drag.ts
    holds the rule; this is the wiring.

    A touch that starts on the grip is left to the grip: it has
    `touch-action: none` and pointer capture, and handling it here as well
    would move the sheet twice for one finger.
  */
  useEffect(() => {
    const el = asideRef.current;
    if (!el || state !== "open") return;
    let startX = 0;
    let startY = 0;
    let mode: SheetTouch = "wait";
    let travelled = 0;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) return;
      if ((e.target as Element | null)?.closest(".pbm-rail-grip")) {
        mode = "scroll";
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      mode = "wait";
      travelled = 0;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || mode === "scroll") return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (mode === "wait") mode = decideSheetTouch(el.scrollTop, dx, dy);
      if (mode !== "drag") return;
      if (e.cancelable) e.preventDefault();
      travelled = sheetOffset(dy);
      setDragY(travelled);
    };
    const onEnd = () => {
      const wasDrag = mode === "drag";
      const distance = travelled;
      mode = "wait";
      travelled = 0;
      if (!wasDrag) return;
      setDragY(0);
      if (shouldCloseOnRelease(distance)) onClose();
    };
    // Taken away by the system — never a close, however far it had moved.
    const onCancel = () => {
      if (mode === "drag") setDragY(0);
      mode = "wait";
      travelled = 0;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [state, onClose]);

  /*
    Escape closes the sheet — but only while it IS a sheet.

    ── WHY THIS WAS MISSING ──
    Every other overlay in the product closes on Escape: LabelManager,
    LabelPicker, the nav drawer, the status menu. The rail was the one that did
    not, and it is the only one that can be dismissed by dragging, which is
    presumably why nobody noticed — a touch gesture has no keyboard equivalent,
    so the omission is invisible to anyone using a mouse or a finger.

    The close button means this was never a 2.1.1 failure; the rail was always
    operable from a keyboard. It is a consistency gap, and it costs nothing to
    close.

    ── ONLY WHEN THERE IS SOMETHING TO CLOSE ──
    Above 1180px the rail is a COLUMN, the scrim is `display: none`, and
    nothing is covering the page. Handling Escape there would swallow a key the
    browser and the page may want — the same reasoning LabelManager gives for
    not binding Escape in its inline mode. The query mirrors the mail.css
    breakpoint, as Thread's own `wide` check does.
  */
  useEffect(() => {
    if (state !== "open") return;
    const overlay = window.matchMedia("(max-width: 1180px)");
    if (!overlay.matches) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  const firstSeen = formatFirstSeen(contact.firstSeenIso);
  // Derived on render, not stored: it is a judgement about the address as it
  // is right now, and the rules can improve without a backfill.
  const emailTypo = detectEmailTypo(contact.email);

  return (
    <>
      <div
        className="pbm-rail-scrim"
        data-rail={state}
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={asideRef}
        className="pbm-rail pb-scroll"
        data-rail={state}
        data-dragging={dragY !== 0 || undefined}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        aria-label="Contact details"
      >
        <SheetGrip onClose={onClose} onOffset={setDragY} />
        <div className="pbm-rail-head">
          <h2 className="pbm-rail-title">General info</h2>
          <button className="pbm-rail-close" onClick={onClose} aria-label="Hide contact details">
            <Icon name="close" size={16} strokeWidth={2.4} />
          </button>
        </div>

        <div className="pbm-rail-card">
          <div>
            <p className="pbm-rail-name">{contact.name}</p>
            <p className="pbm-rail-void">No phone number on file</p>
          </div>
          <Field label="Email" value={contact.email} />
          {/*
            Shown only when the address is OBVIOUSLY wrong — see
            lib/email-typo.ts, which flags a short list of certain slips and
            stays quiet about everything else. A false positive here tells a
            business their customer's perfectly good address is broken, and
            somebody rings a customer to correct an email that was already
            right, so the module errs heavily towards silence.

            The enquiry itself was never refused over this. Losing somebody's
            actual customer because they mistyped their own return address
            would be far worse than a bounce — the message still has a name, a
            question and often a phone number in it.
          */}
          {emailTypo && (
            <p className="pbm-rail-warn">{describeEmailTypo(emailTypo)}</p>
          )}
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
