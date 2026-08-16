"use client";

import { Icon } from "./icons";
import type { ContactCard } from "./types";

/**
 * The 290px contact rail — a bottom sheet below 768px.
 *
 * Be warned reading this: most of the design's rail has no data behind it.
 * Name, email, first contact and ticket count are real. Phone number,
 * lifecycle status, notes and the four disclosure sections are not stored
 * anywhere, so they render as explicit "not recorded" / "not built" states
 * rather than plausible-looking filler.
 */

const UNBUILT_SECTIONS = [
  "Additional info",
  "Shared files",
  "Shared links",
  "Documentation",
];

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
}: {
  contact: ContactCard;
  /** "auto" = column on a wide screen, hidden below 1180px. See Thread.tsx. */
  state: "auto" | "open" | "closed";
  onClose: () => void;
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

        <h3 className="pbm-rail-title pbm-rail-title--sub">Notes</h3>
        <div className="pbm-rail-card pbm-rail-card--empty">
          <p className="pbm-rail-void">
            Notes aren&rsquo;t built yet. There is nowhere to save one, so this
            list stays empty.
          </p>
        </div>

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
