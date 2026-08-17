"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LabelColor } from "@/db/schema";
import { Icon } from "./icons";
import type { LabelWithCountDTO } from "./types";

/**
 * Create, rename, recolour and delete a workspace's labels.
 *
 * A modal rather than a page: it is opened from the nav's label list, and the
 * thing you are editing is visible behind it. Esc and the scrim close it, the
 * dialog traps nothing (there is nowhere else to tab to inside the shell while
 * it is open) but does move focus to the name field on open.
 *
 * Colour is picked from three swatches, never a colour wheel — the column
 * stores a token key, and offering a wheel would promise a fidelity the schema
 * cannot keep.
 *
 * Deletion confirms IN the modal, on the row being deleted. It used to call
 * `window.confirm`: unstyleable, unthemeable across the six themes, impossible
 * to assert on in a test, and — being modal to the whole browser — it stole
 * focus out of a dialog that is itself modal. Turning the row into its own
 * question also puts the consequence beside the thing it applies to, which a
 * system alert with the label's name quoted into a string never managed.
 *
 * components/InstallView.tsx still calls window.confirm/window.alert for the
 * API-key rotation. Same argument applies there; it is owned elsewhere.
 */

const COLOR_ORDER: LabelColor[] = ["tag_a", "tag_b", "tag_c"];

export default function LabelManager({
  labels,
  onClose,
}: {
  labels: LabelWithCountDTO[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<LabelWithCountDTO[]>(labels);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<LabelColor>("tag_a");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  /** Row currently asking "are you sure?". Only ever one at a time. */
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  /** Screen-reader narration for changes that are otherwise silent. */
  const [announcement, setAnnouncement] = useState("");
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Focus the new-label field, once, on open.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc backs out of the delete question first, and only closes the whole
      // modal once no question is outstanding. Otherwise the key that means
      // "cancel this" would also discard the editing you came here to do —
      // which is precisely the trap window.confirm avoided by hijacking the
      // entire browser, and a worse cure than the disease.
      if (confirmingId !== null) setConfirmingId(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, confirmingId]);

  async function create() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: newColor }),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as {
      label?: LabelWithCountDTO;
      error?: string;
    };
    if (!res.ok || !data.label) {
      setError(data.error ?? "Couldn't create that label.");
      return;
    }
    setRows(
      [...rows, data.label].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setNewName("");
    setAnnouncement(`Label ${data.label.name} created.`);
    router.refresh();
  }

  async function patch(id: number, body: { name?: string; color?: LabelColor }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/labels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as {
      label?: { id: number; name: string; color: LabelColor };
      error?: string;
    };
    if (!res.ok || !data.label) {
      setError(data.error ?? "Couldn't save that change.");
      return;
    }
    const label = data.label;
    setRows(
      rows
        .map((r) => (r.id === id ? { ...r, name: label.name, color: label.color } : r))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditingId(null);
    // Colour has no accessible name of its own — the swatches are "Colour 1/2/3"
    // — so a recolour is the change most likely to pass a screen-reader user by.
    setAnnouncement(
      body.name !== undefined
        ? `Label renamed to ${label.name}.`
        : `Colour changed for ${label.name}.`,
    );
    router.refresh();
  }

  async function remove(row: LabelWithCountDTO) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/labels/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Couldn't delete that label.");
      setAnnouncement(`Couldn't delete ${row.name}. Nothing was changed.`);
      return;
    }
    setConfirmingId(null);
    setRows(rows.filter((r) => r.id !== row.id));
    setAnnouncement(`Label ${row.name} deleted.`);
    // The row the keyboard was standing on has just ceased to exist. Without
    // this, focus drops to <body> and the next Tab restarts from the top of the
    // document — outside the modal. The new-label field is the one control in
    // here that is always present.
    firstFieldRef.current?.focus();
    router.refresh();
  }

  /** The sentence the confirm step asks. */
  function deleteQuestion(row: LabelWithCountDTO): string {
    if (row.ticketCount === 0) return `Delete “${row.name}”?`;
    return `Delete “${row.name}”? It comes off ${row.ticketCount} ${
      row.ticketCount === 1 ? "ticket" : "tickets"
    } — the tickets themselves are not affected.`;
  }

  return (
    <>
      <div className="pbm-modal-scrim" onClick={onClose} aria-hidden />
      <div
        className="pbm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Manage labels"
      >
        <div className="pbm-modal-head">
          <h2 className="pbm-modal-title">Labels</h2>
          <button
            className="pbm-rail-close"
            onClick={onClose}
            aria-label="Close label manager"
          >
            <Icon name="close" size={12} strokeWidth={2.4} />
          </button>
        </div>

        <div className="pbm-modal-body pb-scroll">
          {rows.length === 0 && (
            <p className="pbm-modal-note">
              No labels yet. Labels are shared by everyone in this workspace.
            </p>
          )}

          {rows.map((row) => (
            <div key={row.id} className="pbm-label-row">
              {confirmingId === row.id ? (
                /* The row becomes the question. role="alertdialog" + the
                   aria-describedby pairing is what a native confirm() gave us
                   for free and has to be spelled out here. */
                <div
                  className="pbm-confirm"
                  role="alertdialog"
                  aria-label={`Delete ${row.name}`}
                  aria-describedby={`pbm-confirm-q-${row.id}`}
                >
                  <p className="pbm-confirm-q" id={`pbm-confirm-q-${row.id}`}>
                    {deleteQuestion(row)}
                  </p>
                  <div className="pbm-confirm-acts">
                    <button
                      type="button"
                      className="pbm-confirm-btn"
                      disabled={busy}
                      /* Focus lands on CANCEL, not Delete. The trash icon this
                         replaced is gone from the row, so whatever the keyboard
                         was on has just unmounted and focus has to go
                         somewhere — and it must not go somewhere a stray Enter
                         or Space destroys a label from. A confirm step whose
                         default action is the destructive one is not a confirm
                         step. Delete is one Tab away. */
                      autoFocus
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="pbm-confirm-btn pbm-confirm-btn--danger"
                      disabled={busy}
                      onClick={() => void remove(row)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : editingId === row.id ? (
                <>
                  <input
                    className="pbm-label-input"
                    value={editName}
                    maxLength={40}
                    aria-label={`Rename ${row.name}`}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void patch(row.id, { name: editName.trim() });
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <button
                    className="pbm-label-create"
                    disabled={!editName.trim() || busy}
                    onClick={() => void patch(row.id, { name: editName.trim() })}
                  >
                    Save
                  </button>
                </>
              ) : (
                <>
                  <span className="pbm-label" data-color={row.color}>
                    <span className="pbm-label-name">{row.name}</span>
                  </span>
                  <span className="pbm-label-count">
                    {row.ticketCount}{" "}
                    {row.ticketCount === 1 ? "ticket" : "tickets"}
                  </span>
                  <div
                    className="pbm-swatches"
                    role="radiogroup"
                    aria-label={`Colour for ${row.name}`}
                  >
                    {COLOR_ORDER.map((c, i) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={row.color === c}
                        aria-label={`Colour ${i + 1} for ${row.name}`}
                        className="pbm-label-swatch pbm-label-swatch--pick"
                        data-color={c}
                        data-on={row.color === c || undefined}
                        onClick={() => void patch(row.id, { color: c })}
                      />
                    ))}
                  </div>
                  <button
                    className="pbm-label-icon"
                    aria-label={`Rename ${row.name}`}
                    title="Rename"
                    onClick={() => {
                      setEditingId(row.id);
                      setEditName(row.name);
                    }}
                  >
                    <Icon name="pencil" size={13} strokeWidth={2} />
                  </button>
                  <button
                    className="pbm-label-icon pbm-label-icon--danger"
                    aria-label={`Delete ${row.name}`}
                    title="Delete"
                    onClick={() => {
                      setError(null);
                      setEditingId(null);
                      setConfirmingId(row.id);
                    }}
                  >
                    <Icon name="trash" size={13} strokeWidth={2} />
                  </button>
                </>
              )}
            </div>
          ))}

          <div className="pbm-label-row pbm-label-row--new">
            <input
              ref={firstFieldRef}
              className="pbm-label-input"
              value={newName}
              maxLength={40}
              placeholder="New label…"
              aria-label="Name for a new label"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <div
              className="pbm-swatches"
              role="radiogroup"
              aria-label="Colour for the new label"
            >
              {COLOR_ORDER.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={newColor === c}
                  aria-label={`Colour ${i + 1}`}
                  className="pbm-label-swatch pbm-label-swatch--pick"
                  data-color={c}
                  data-on={newColor === c || undefined}
                  onClick={() => setNewColor(c)}
                />
              ))}
            </div>
            <button
              className="pbm-label-create"
              disabled={!newName.trim() || busy}
              onClick={() => void create()}
            >
              <Icon name="plus" size={12} strokeWidth={2.4} />
              Add
            </button>
          </div>

          {error && (
            <p className="pbm-modal-note pbm-modal-note--error" role="alert">
              {error}
            </p>
          )}

          {/* Always mounted, empty until there is something to say: a live
              region added at the same moment as its text is routinely missed. */}
          <p className="pbm-sr" role="status" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>
    </>
  );
}
