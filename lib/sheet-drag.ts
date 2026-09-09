/**
 * The maths behind dragging the contact sheet.
 *
 * Pure, and separate from components/mail/SheetGrip.tsx, for a reason worth
 * stating: the component is pointer handlers and a piece of React state, and
 * this repo has no DOM test environment — no jsdom, no Testing Library — so a
 * component is code that ships having never been executed. The DECISIONS it
 * makes do not need a DOM, so they live here where they can be run.
 *
 * What is left in the component is the wiring: capture the pointer, call
 * these, set state. What is here is every rule that could be wrong.
 */

/** Past this many pixels of downward travel, releasing closes the sheet. */
export const CLOSE_AFTER_PX = 110;

/** How far the sheet may be pulled ABOVE its resting position. */
export const RUBBER_BAND_LIMIT_PX = 28;

/**
 * Where the sheet should sit for a given drag distance.
 *
 * Down is followed exactly: a sheet that lags your finger reads as the app
 * being slow, and there is nothing above it to reveal by damping.
 *
 * Up is damped to a third and capped, which is the part that has to be
 * deliberate. The sheet is already at its top stop, so it CANNOT usefully go
 * further — but freezing it dead at 0 reads as a broken control rather than as
 * a limit. Giving a little and refusing to give more is how a surface says
 * "there is nothing above this" without feeling stuck.
 */
export function sheetOffset(dy: number): number {
  if (dy >= 0) return dy;
  return Math.max(dy / 3, -RUBBER_BAND_LIMIT_PX);
}

/**
 * On release: does the sheet close, or spring back?
 *
 * Distance only, deliberately — no velocity. A flick is nicer on paper and
 * needs timestamps, a sampling window and a threshold nobody can justify from
 * first principles; the failure mode when it is tuned wrong is a sheet that
 * closes when you meant to peek, which loses whatever was underneath. A fixed
 * distance is predictable, and the gesture here is "push it away", not "throw
 * it".
 */
export function shouldCloseOnRelease(offset: number): boolean {
  return offset > CLOSE_AFTER_PX;
}

/**
 * What a touch that began on the sheet's BODY should become.
 *
 * ── WHY THE BODY DRAGS AT ALL ──
 * The grip works. Jordan could drag it with a mouse in a phone-sized window
 * and could not drag the sheet on his phone, and the difference is not the
 * browser: it is where a thumb lands. A mouse goes to the 32px strip above
 * the title because it can see it; a thumb goes to the sheet, and the sheet
 * is a scroller, so the drag scrolled — or, at the top, rubber-banded — and
 * the sheet stayed put. Every native bottom sheet answers this the same way:
 * when the content is already at its top and the finger moves DOWN, the
 * sheet moves, because there is nothing left to scroll.
 *
 * ── THE RULE ──
 * Scroll unless ALL of: the body is scrolled to its top, the finger is moving
 * down, and it is moving more down than sideways. "wait" only while the
 * finger has not moved at all. Decided on the first move and never revisited,
 * because a browser that has begun scrolling ignores preventDefault on every
 * later touchmove — the claim has to be made before that, or not at all.
 */
export type SheetTouch = "wait" | "drag" | "scroll";

export function decideSheetTouch(
  scrollTop: number,
  dx: number,
  dy: number,
): SheetTouch {
  if (dx === 0 && dy === 0) return "wait";
  if (scrollTop > 0) return "scroll";
  if (dy <= 0) return "scroll";
  if (Math.abs(dx) > dy) return "scroll";
  return "drag";
}
