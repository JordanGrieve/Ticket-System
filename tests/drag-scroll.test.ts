import { describe, it, expect } from "vitest";
import { isDragging, scrollTarget, DRAG_SLOP_PX } from "../lib/drag-scroll";

/**
 * Dragging a horizontal strip with a mouse.
 *
 * `overflow-x: auto` gives touch scrolling for free and a pointing device
 * nothing, which is why press-and-drag did nothing when testing the settings
 * tabs in a browser's mobile emulator.
 *
 * The listeners are in components/DragScroller.tsx and are not covered here —
 * no DOM environment in this repo. These are the two rules that would be wrong
 * in a way somebody feels immediately.
 */

describe("telling a drag from a click", () => {
  it("treats a small movement as a click", () => {
    /*
      THE RULE THAT KEEPS THE LINKS WORKING.

      Every child of the strip is a Link. Without slop, the pixel or two
      between pressing and releasing counts as a drag, the click is
      suppressed, and the strip scrolls beautifully while navigating nowhere.
    */
    expect(isDragging(0)).toBe(false);
    expect(isDragging(1)).toBe(false);
    expect(isDragging(DRAG_SLOP_PX)).toBe(false);
  });

  it("treats a real drag as a drag", () => {
    expect(isDragging(DRAG_SLOP_PX + 1)).toBe(true);
    expect(isDragging(120)).toBe(true);
  });

  it("uses a slop small enough not to swallow a deliberate short drag", () => {
    // Big enough to absorb the wobble of a click, small enough that nudging
    // the strip a few pixels still moves it.
    expect(DRAG_SLOP_PX).toBeGreaterThan(1);
    expect(DRAG_SLOP_PX).toBeLessThan(12);
  });
});

describe("which way the strip moves", () => {
  it("scrolls RIGHT when the pointer is dragged LEFT", () => {
    /*
      The content follows the finger, so the scroll position moves the other
      way. Inverting this is the single most common bug in a drag-scroller and
      it feels wrong within one gesture — which is exactly why it is asserted
      rather than trusted to a minus sign somebody reads once.

      Started at 0, dragged 50px left (200 -> 150): the strip scrolls to 50.
    */
    expect(scrollTarget(0, 200, 150, 500)).toBe(50);
  });

  it("scrolls LEFT when the pointer is dragged RIGHT", () => {
    // Started at 100, dragged 40px right (200 -> 240): back to 60.
    expect(scrollTarget(100, 200, 240, 500)).toBe(60);
  });

  it("stays put when the pointer has not moved", () => {
    expect(scrollTarget(80, 200, 200, 500)).toBe(80);
  });

  it("cannot be dragged past the start", () => {
    // A fast drag right at scrollLeft 0 would ask for a negative position.
    // Browsers floor it silently; clamping here means the number this returns
    // is the number that gets used, so the caller is never lied to.
    expect(scrollTarget(0, 200, 600, 500)).toBe(0);
    expect(scrollTarget(20, 200, 900, 500)).toBe(0);
  });

  it("cannot be dragged past the end", () => {
    expect(scrollTarget(400, 200, -400, 500)).toBe(500);
  });

  it("clamps to zero when there is nothing to scroll", () => {
    // A strip narrower than its container has maxScrollLeft <= 0. Math.max
    // guards the negative, so this cannot return a nonsense position for a
    // strip that fits.
    expect(scrollTarget(0, 200, 100, 0)).toBe(0);
    expect(scrollTarget(0, 200, 100, -30)).toBe(0);
  });
});
