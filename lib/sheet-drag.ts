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
