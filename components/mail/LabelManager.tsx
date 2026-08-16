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
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    router.refresh();
  }

  async function remove(row: LabelWithCountDTO) {
    if (busy) return;
    const warning =
      row.ticketCount > 0
        ? `Delete “${row.name}”? It will come off ${row.ticketCount} ${
            row.ticketCount === 1 ? "ticket" : "tickets"
          }. The tickets themselves are not affected.`
        : `Delete “${row.name}”?`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/labels/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Couldn't delete that label.");
      return;
    }
    setRows(rows.filter((r) => r.id !== row.id));
    router.refresh();
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
              {editingId === row.id ? (
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
                    onClick={() => void remove(row)}
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
        </div>
      </div>
    </>
  );
}
