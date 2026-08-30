"use client";

import { useEffect, useRef, useState } from "react";
import { labelChipProps } from "./label-style";
import { useRouter } from "next/navigation";
import type { LabelColor } from "@/db/schema";
import { Icon } from "./icons";
import type { LabelChipDTO } from "./types";

/**
 * The labels on one ticket, plus the menu that adds and removes them.
 *
 * Colour never reaches this file as a value: the chip carries `data-color` and
 * mail.css resolves it to the --tag-* token pair, so a label repaints with the
 * theme instead of being frozen at whatever it looked like when it was made.
 *
 * Menu behaviour matches the status menu next to it — Esc and a click outside
 * close it, and the trigger carries aria-haspopup/aria-expanded.
 */

const COLOR_ORDER: LabelColor[] = ["tag_a", "tag_b", "tag_c"];

export default function LabelPicker({
  ticketId,
  labels,
  allLabels,
}: {
  ticketId: number;
  /** Labels currently on this ticket, from the server. */
  labels: LabelChipDTO[];
  /** Every label in the workspace, for the menu. */
  allLabels: LabelChipDTO[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<LabelChipDTO[]>(labels);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<LabelColor>("tag_a");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Screen-reader narration. `aria-checked` on the menu items covers toggling
   * from inside the open menu, but says nothing about the chips outside it —
   * and the "x" on a chip removes a label from a control that then disappears,
   * taking any state announcement with it.
   */
  const [announcement, setAnnouncement] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  // Adopt the server's answer when the page refreshes underneath us.
  const [lastProp, setLastProp] = useState(labels);
  if (lastProp !== labels) {
    setLastProp(labels);
    setCurrent(labels);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const onIds = new Set(current.map((l) => l.id));

  async function toggle(label: LabelChipDTO, on: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const before = current;
    setCurrent(
      on
        ? [...current, label].sort((a, b) => a.name.localeCompare(b.name))
        : current.filter((l) => l.id !== label.id),
    );
    const res = await fetch(`/api/tickets/${ticketId}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelId: label.id, on }),
    });
    setBusy(false);
    if (!res.ok) {
      setCurrent(before);
      setError("Couldn't change that label.");
      setAnnouncement(`Couldn't change label ${label.name}. Nothing was saved.`);
      return;
    }
    const data = (await res.json()) as { labels?: LabelChipDTO[] };
    if (data.labels) setCurrent(data.labels);
    setAnnouncement(
      on ? `Label ${label.name} added.` : `Label ${label.name} removed.`,
    );
    router.refresh();
  }

  async function createAndApply() {
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
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Couldn't create that label.");
      return;
    }
    const data = (await res.json()) as { label: LabelChipDTO };
    setNewName("");
    await toggle(data.label, true);
  }

  return (
    <div className="pbm-labels" ref={menuRef}>
      {/* Mounted always, empty until there is something to say — a live region
          inserted alongside its own text is frequently not announced. */}
      <span className="pbm-sr" role="status" aria-live="polite">
        {announcement}
      </span>

      {current.map((l) => (
        <span key={l.id} className="pbm-label" {...labelChipProps(l)}>
          <span className="pbm-label-name">{l.name}</span>
          <button
            type="button"
            className="pbm-label-x"
            aria-label={`Remove label ${l.name}`}
            title={`Remove label ${l.name}`}
            onClick={() => void toggle(l, false)}
          >
            <Icon name="close" size={10} strokeWidth={3} />
          </button>
        </span>
      ))}

      <button
        type="button"
        className="pbm-label-add"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add or remove labels"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="label" size={12} strokeWidth={2} />
        <span>Label</span>
      </button>

      {open && (
        <div className="pbm-menu pbm-menu--labels" role="menu">
          {allLabels.length === 0 && (
            <p className="pbm-menu-note">
              No labels yet. Make the first one below.
            </p>
          )}
          {allLabels.map((l) => {
            const on = onIds.has(l.id);
            return (
              <button
                key={l.id}
                role="menuitemcheckbox"
                aria-checked={on}
                className="pbm-menu-item"
                onClick={() => void toggle(l, !on)}
              >
                <span className="pbm-label-swatch" {...labelChipProps(l)} />
                <span className="pbm-menu-text">{l.name}</span>
                {on && <span className="pbm-menu-check">✓</span>}
              </button>
            );
          })}

          <div className="pbm-menu-divider" />
          <div className="pbm-label-new">
            <input
              className="pbm-label-input"
              value={newName}
              maxLength={40}
              placeholder="New label…"
              aria-label="Name for a new label"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createAndApply();
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
              <button
                type="button"
                className="pbm-label-create"
                disabled={!newName.trim() || busy}
                onClick={() => void createAndApply()}
              >
                Add
              </button>
            </div>
          </div>
          {error && (
            <p className="pbm-menu-note pbm-menu-note--error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
