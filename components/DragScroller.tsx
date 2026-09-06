"use client";

import { useRef, type ReactNode } from "react";
import { DRAG_SLOP_PX, isDragging, scrollTarget } from "@/lib/drag-scroll";

/**
 * Makes a horizontally scrolling strip draggable with a mouse or pen.
 *
 * Touch already works — `overflow-x: auto` handles it, and the settings strip
 * declares `touch-action: pan-x` so the gesture is not stolen by the page. A
 * POINTING device gets nothing from that: press-and-drag, which is the first
 * thing anybody tries and the only thing available in a browser's mobile
 * emulator with touch emulation off, does nothing at all.
 *
 * ── IT MUST NOT BREAK THE LINKS ──
 * Every child of the strip this wraps is a Link. So the drag only begins after
 * DRAG_SLOP_PX of travel, and the click is suppressed only if that threshold
 * was crossed. Below it the press is left completely alone and navigates
 * normally. A strip that scrolls perfectly and never navigates would be a
 * straight downgrade.
 *
 * ── POINTER EVENTS, NOT MOUSE ──
 * One path for mouse and pen, and `pointerType === "touch"` bails immediately
 * so this never fights the native touch scrolling that already works.
 *
 * The rules that could be wrong — the slop, and which way the content moves
 * relative to the finger — are in lib/drag-scroll.ts, where they are tested.
 * This file is listeners, which cannot be: no DOM environment in this repo.
 */
export default function DragScroller({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const el = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; scrollLeft: number } | null>(null);
  const travel = useRef(0);

  return (
    <div
      ref={el}
      className={className}
      {...rest}
      onPointerDown={(e) => {
        // Native touch scrolling already works and is better than anything
        // reimplemented here.
        if (e.pointerType === "touch") return;
        const node = el.current;
        if (!node || node.scrollWidth <= node.clientWidth) return;
        start.current = { x: e.clientX, scrollLeft: node.scrollLeft };
        travel.current = 0;
      }}
      onPointerMove={(e) => {
        const node = el.current;
        const from = start.current;
        if (!node || !from) return;
        travel.current = Math.abs(e.clientX - from.x);
        if (!isDragging(travel.current)) return;
        // Capture only once the drag is real, so a plain click is never
        // swallowed by a capture that was taken speculatively.
        if (!node.hasPointerCapture(e.pointerId)) {
          node.setPointerCapture(e.pointerId);
        }
        node.scrollLeft = scrollTarget(
          from.scrollLeft,
          from.x,
          e.clientX,
          node.scrollWidth - node.clientWidth,
        );
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
        travel.current = 0;
      }}
      onClickCapture={(e) => {
        // Capture phase, so the Link never sees a click that was really the
        // end of a drag. Only fires past the slop; a tap is untouched.
        if (isDragging(travel.current)) {
          e.preventDefault();
          e.stopPropagation();
        }
        travel.current = 0;
      }}
      // Never leave the strip mid-drag in a state where the next click is
      // eaten because the pointer left the window.
      onPointerLeave={() => {
        if (!start.current) travel.current = 0;
      }}
    >
      {children}
    </div>
  );
}
