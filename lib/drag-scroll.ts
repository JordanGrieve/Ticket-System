/**
 * Dragging a horizontal strip with a pointing device.
 *
 * ── WHY THIS IS NEEDED AT ALL ──
 * `overflow-x: auto` gives a strip touch scrolling for free and a mouse
 * nothing. A trackpad can scroll it sideways and Shift+wheel works, but
 * pressing and dragging — the thing everybody tries first, and the ONLY thing
 * available in a browser's mobile emulator without touch emulation on — does
 * nothing at all. Reported as "it does not scroll on desktop when I switch to
 * mobile view for testing", which is exactly that gap.
 *
 * ── WHY THE DECISIONS LIVE HERE ──
 * Same reason as lib/sheet-drag.ts: the listeners need a DOM and this repo has
 * no DOM test environment, so anything that could be WRONG is kept out of the
 * handler and put where it can be run.
 */

/**
 * How far a drag must travel before it counts as a drag rather than a click.
 *
 * A tab strip's children are links. Without a threshold, the tiny movement
 * between pressing and releasing turns every tap into a drag and the link
 * never fires — the strip would scroll beautifully and navigate to nothing.
 */
export const DRAG_SLOP_PX = 4;

/** Has the pointer moved far enough to be scrolling rather than clicking? */
export function isDragging(totalTravelPx: number): boolean {
  return totalTravelPx > DRAG_SLOP_PX;
}

/**
 * Where the strip should be scrolled to, given where the drag began.
 *
 * Inverted, because the CONTENT follows the finger: dragging left moves the
 * content left, which means scrolling right. Getting this backwards is the
 * single most common bug in a drag-scroller and it feels immediately wrong to
 * anybody who tries it, so it is pinned rather than trusted.
 *
 * Clamped to the scrollable range so a fast drag cannot ask for a negative
 * scrollLeft, which browsers silently floor at 0 — the clamp is not for the
 * browser, it is so the number this returns is the number that ends up used.
 */
export function scrollTarget(
  startScrollLeft: number,
  startX: number,
  currentX: number,
  maxScrollLeft: number,
): number {
  const wanted = startScrollLeft - (currentX - startX);
  return Math.min(Math.max(wanted, 0), Math.max(maxScrollLeft, 0));
}
