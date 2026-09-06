import { describe, it, expect } from "vitest";
import {
  sheetOffset,
  shouldCloseOnRelease,
  CLOSE_AFTER_PX,
  RUBBER_BAND_LIMIT_PX,
} from "../lib/sheet-drag";

/**
 * Dragging the contact sheet away.
 *
 * The gesture itself is pointer handlers in components/mail/SheetGrip.tsx and
 * cannot be tested here — this repo has no DOM environment. What CAN be tested
 * is every decision the gesture makes, which is why those live in lib.
 *
 * Worth being blunt about the split: the component is wiring that ships
 * unexecuted, so the rules it defers to are the only part with a safety net,
 * and they are the part that would be wrong in a way somebody notices.
 */

describe("how far the sheet moves", () => {
  it("follows a downward drag exactly", () => {
    // Any damping downward reads as the app lagging behind the finger, and
    // there is nothing above the sheet that damping would reveal.
    expect(sheetOffset(0)).toBe(0);
    expect(sheetOffset(1)).toBe(1);
    expect(sheetOffset(60)).toBe(60);
    expect(sheetOffset(400)).toBe(400);
  });

  it("damps an upward drag to a third", () => {
    // The sheet is already at its top stop. It gives, so the control does not
    // feel dead, but it gives less than the finger asks for.
    expect(sheetOffset(-30)).toBe(-10);
    expect(sheetOffset(-60)).toBe(-20);
  });

  it("never lets the sheet climb past the rubber-band limit", () => {
    // A hard cap, so a long upward drag cannot tear the sheet off the top of
    // the screen and leave a gap underneath it.
    expect(sheetOffset(-500)).toBe(-RUBBER_BAND_LIMIT_PX);
    expect(sheetOffset(-10000)).toBe(-RUBBER_BAND_LIMIT_PX);
    expect(sheetOffset(-84)).toBe(-RUBBER_BAND_LIMIT_PX);
  });

  it("is continuous through zero", () => {
    /*
      A jump at the turning point would show as the sheet flicking as the
      finger crosses its start position, which is the one place a drag is most
      likely to hover.
    */
    expect(sheetOffset(-0.3)).toBeCloseTo(-0.1, 5);
    expect(sheetOffset(0)).toBe(0);
    expect(sheetOffset(0.3)).toBeCloseTo(0.3, 5);
  });
});

describe("whether releasing closes the sheet", () => {
  it("springs back below the threshold", () => {
    // Peeking must be free. Somebody who nudges the sheet to see what is
    // behind it and lets go has not asked for it to close.
    expect(shouldCloseOnRelease(0)).toBe(false);
    expect(shouldCloseOnRelease(40)).toBe(false);
    expect(shouldCloseOnRelease(CLOSE_AFTER_PX)).toBe(false);
  });

  it("closes past the threshold", () => {
    expect(shouldCloseOnRelease(CLOSE_AFTER_PX + 1)).toBe(true);
    expect(shouldCloseOnRelease(400)).toBe(true);
  });

  it("never closes on an upward drag", () => {
    expect(shouldCloseOnRelease(-10)).toBe(false);
    expect(shouldCloseOnRelease(-RUBBER_BAND_LIMIT_PX)).toBe(false);
    expect(shouldCloseOnRelease(sheetOffset(-500))).toBe(false);
  });

  it("does not close on a large negative, whatever the caller passed", () => {
    /*
      THE ASSERTION THE THREE ABOVE ONLY LOOKED LIKE.

      Written first as "never closes on an upward drag" and checked by putting
      an abs() into the comparison — the classic wrong-way-round bug. It did
      NOT fail. Every value those three try is already clamped by sheetOffset
      to at most -28, and abs(-28) is under the 110 threshold, so the assertions
      passed while measuring nothing about the sign at all.

      That is only safe as long as the caller clamps. shouldCloseOnRelease is
      exported and takes a number; it must not depend on its one current caller
      to protect it, and if RUBBER_BAND_LIMIT_PX ever grows past the threshold
      the bug becomes live. So this passes a raw negative that no clamp would
      produce, which is what actually pins the sign.
    */
    expect(shouldCloseOnRelease(-400)).toBe(false);
    expect(shouldCloseOnRelease(-CLOSE_AFTER_PX * 2)).toBe(false);
  });

  it("the threshold is a deliberate distance, not an accident of units", () => {
    // Far enough that a scroll-flick misread as a drag does not dismiss;
    // short enough to complete with a thumb without repositioning.
    expect(CLOSE_AFTER_PX).toBeGreaterThan(60);
    expect(CLOSE_AFTER_PX).toBeLessThan(200);
  });
});
