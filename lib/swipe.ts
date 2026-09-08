/**
 * The maths behind swiping an inbox card to reveal Archive and Delete.
 *
 * Pure, and separate from components/mail/SwipeRow.tsx for the reason
 * lib/sheet-drag.ts gives: the component is pointer handlers and React state
 * and this repo's tests have no DOM for it, so every rule that could be wrong
 * lives here where it can be run.
 */

/** Width of one revealed action button, in px. Matches .pbm-swipe-btn. */
export const ACTION_PX = 72;

/** Gap between the two buttons, and before the first. Matches the CSS. */
export const ACTION_GAP_PX = 8;

/** How far the card travels to fully expose both actions. */
export const REVEAL_PX = ACTION_PX * 2 + ACTION_GAP_PX * 2;

/** Past this much travel the browser's own scroll has to yield to the swipe. */
export const CLAIM_PX = 8;

/** How far the card may be pulled past the fully-revealed position. */
export const OVERSHOOT_PX = 24;

export type Claim = "undecided" | "horizontal" | "vertical";

/**
 * Whose gesture is this — ours, or the page's?
 *
 * Decided ONCE, at the first movement that is clearly one or the other.
 * Nothing is claimed inside the dead zone, so a still finger stays a tap.
 * Beyond it the axis with more travel wins, with a bias toward vertical:
 * scrolling the list is what a thumb does hundreds of times a day, and a
 * diagonal drag that hijacks it to half-open a card is far more annoying than
 * a swipe that needs to be a little more deliberate.
 */
export function claimSwipe(dx: number, dy: number): Claim {
  if (Math.abs(dx) < CLAIM_PX && Math.abs(dy) < CLAIM_PX) return "undecided";
  return Math.abs(dx) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical";
}

/**
 * Where the card sits for a drag of `dx` px, starting from open or closed.
 *
 * Leftward is followed exactly up to the reveal point, then damped to a third
 * and capped — the same rubber band the contact sheet uses, and for the same
 * reason: freezing dead at the limit reads as a broken control, giving a
 * little and refusing more reads as "there is nothing further".
 *
 * Rightward from closed is refused outright rather than damped. There is
 * nothing on that side to hint at, and a card that slides right on a
 * rightward flick would suggest there is.
 */
export function swipeOffset(dx: number, open: boolean): number {
  const raw = (open ? -REVEAL_PX : 0) + dx;
  if (raw > 0) return 0;
  if (raw >= -REVEAL_PX) return raw;
  return Math.max(-REVEAL_PX + (raw + REVEAL_PX) / 3, -REVEAL_PX - OVERSHOOT_PX);
}

/**
 * On release: stay open, or spring shut?
 *
 * Halfway, and distance only — no velocity, for the reason lib/sheet-drag.ts
 * gives. The failure when a flick threshold is tuned wrong is a card that
 * snaps open on a scroll that drifted sideways, with a Delete button now
 * sitting under the thumb.
 */
export function shouldStayOpen(offset: number): boolean {
  return offset <= -REVEAL_PX / 2;
}
