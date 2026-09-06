"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The drag handle on the contact sheet.
 *
 * ── WHY IT MOVES AT ALL ──
 * It was a decorative pill: it LOOKED like the grab handle every bottom sheet
 * on a phone has, and did nothing. That is worse than not drawing one, because
 * the affordance is a promise — people try to drag it, nothing happens, and
 * they conclude the sheet is stuck rather than that the handle is scenery.
 *
 * ── WHAT IT DOES ──
 * Drag down and the sheet follows your finger. Past a threshold, let go and it
 * closes. Short of the threshold it springs back. Dragging UP is resisted
 * rather than blocked — the sheet is already at its top stop, so it gives a
 * little and returns, which is how a sheet says "there is nothing above this"
 * without feeling broken.
 *
 * ── WHY POINTER EVENTS, AND WHY setPointerCapture ──
 * One code path for touch, mouse and pen. Capture means a drag that leaves the
 * handle — likely, since the whole point is moving away from where you started
 * — keeps sending events here instead of being lost to whatever is underneath.
 *
 * ── THE THING THAT MAKES IT FEEL WRONG IF YOU SKIP IT ──
 * `touch-action: none` on the handle, in CSS. Without it the browser claims a
 * vertical drag for page scrolling before the first pointermove arrives, and
 * the sheet twitches or does nothing at all. The handle is the ONE element
 * that opts out; the sheet body keeps scrolling normally, because a sheet you
 * cannot scroll to read is a worse trade than a handle that does not scroll.
 *
 * ── THE SHEET MOVES, NOT THE HANDLE ──
 * This component owns the GESTURE and reports the offset; the rail applies it
 * to the <aside>. A handle that slid on its own while the panel stayed put
 * would read as a broken control rather than a moving sheet, and the rail is
 * the only element that knows its own transform and transition.
 *
 * ── CLOSING IS THE CALLER'S JOB ──
 * This reports "the user dragged it away" and the rail decides what that
 * means. Same onClose as the cross and the scrim, so there is one close path
 * rather than three that can drift.
 */
export default function SheetGrip({
  onClose,
  onOffset,
}: {
  onClose: () => void;
  /** Live drag distance in px, 0 when at rest. The rail translates by this. */
  onOffset: (px: number) => void;
}) {
  const startY = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  /** Past this many pixels, letting go closes the sheet. */
  const CLOSE_AT = 110;

  const end = useCallback(() => {
    if (startY.current === null) return;
    const travelled = offset;
    startY.current = null;
    setDragging(false);
    setOffset(0);
    onOffset(0);
    if (travelled > CLOSE_AT) onClose();
  }, [offset, onClose, onOffset]);

  return (
    <div
      className="pbm-rail-grip"
      data-dragging={dragging || undefined}
      /*
        A real button, not a decorative div. Somebody who cannot drag still has
        to be able to close the sheet from here, and the cross in the header is
        the other way — but a handle that is invisible to a keyboard while
        looking interactive is the same broken promise in a different form.
      */
      role="button"
      tabIndex={0}
      aria-label="Close contact details"

      onPointerDown={(e) => {
        startY.current = e.clientY;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (startY.current === null) return;
        const dy = e.clientY - startY.current;
        // Downward follows the finger exactly. Upward is damped to a third and
        // capped, so the sheet resists rather than tearing off its top stop.
        const next = dy >= 0 ? dy : Math.max(dy / 3, -28);
        setOffset(next);
        onOffset(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClose();
        }
      }}
    />
  );
}
