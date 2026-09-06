// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SheetGrip from "../components/mail/SheetGrip";

/**
 * The contact sheet's drag handle, ACTUALLY EXECUTED.
 *
 * tests/sheet-drag.test.ts covers the maths. This covers the half that had
 * never run: the pointer handlers, the capture, and whether the offset it
 * reports and the close it triggers happen at the right moments.
 *
 * Worth being precise about what a DOM here does and does not prove. happy-dom
 * dispatches the events and runs the handlers, so a wrong condition, a missing
 * reset or a handler that throws is caught. It is not a browser: it does not
 * decide whether a real thumb-drag is claimed by the page scroller, which is
 * what `touch-action: none` is for, and that remains a CSS declaration nobody
 * has felt.
 */

afterEach(cleanup);

/** happy-dom builds a PointerEvent but jsdom-style setPointerCapture is absent. */
function grip() {
  const el = screen.getByRole("button", { name: /close contact details/i });
  el.setPointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => false);
  el.releasePointerCapture = vi.fn();
  return el;
}

const down = (el: Element, y: number) =>
  fireEvent.pointerDown(el, { clientY: y, pointerId: 1 });
const move = (el: Element, y: number) =>
  fireEvent.pointerMove(el, { clientY: y, pointerId: 1 });
const up = (el: Element) => fireEvent.pointerUp(el, { pointerId: 1 });

describe("dragging the sheet", () => {
  it("reports the offset as the pointer moves down", () => {
    const onOffset = vi.fn();
    render(<SheetGrip onClose={vi.fn()} onOffset={onOffset} />);
    const el = grip();

    down(el, 100);
    move(el, 160);

    // 60px down. The sheet follows exactly, so the rail is told 60.
    expect(onOffset).toHaveBeenLastCalledWith(60);
  });

  it("damps an upward drag rather than following it", () => {
    const onOffset = vi.fn();
    render(<SheetGrip onClose={vi.fn()} onOffset={onOffset} />);
    const el = grip();

    down(el, 200);
    move(el, 140); // 60px UP

    expect(onOffset).toHaveBeenLastCalledWith(-20);
  });

  it("ignores movement when no drag has started", () => {
    /*
      A pointermove with no pointerdown before it — a pointer travelling over
      the handle on its way somewhere else. Without the null check on startY
      this would read the sheet as being dragged from wherever the pointer
      happened to enter.
    */
    const onOffset = vi.fn();
    render(<SheetGrip onClose={vi.fn()} onOffset={onOffset} />);
    move(grip(), 400);
    expect(onOffset).not.toHaveBeenCalled();
  });

  it("closes when released past the threshold", () => {
    const onClose = vi.fn();
    render(<SheetGrip onClose={onClose} onOffset={vi.fn()} />);
    const el = grip();

    down(el, 100);
    move(el, 100 + 150); // well past 110
    up(el);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("springs back instead of closing when released short of it", () => {
    const onClose = vi.fn();
    const onOffset = vi.fn();
    render(<SheetGrip onClose={onClose} onOffset={onOffset} />);
    const el = grip();

    down(el, 100);
    move(el, 150); // 50px — a peek
    up(el);

    expect(onClose).not.toHaveBeenCalled();
    // And the sheet is told to go home, or it would stay 50px down forever.
    expect(onOffset).toHaveBeenLastCalledWith(0);
  });

  it("does not close on a long upward drag", () => {
    // The damping makes this a small negative; releasing must still be a
    // spring-back and never a dismissal.
    const onClose = vi.fn();
    render(<SheetGrip onClose={onClose} onOffset={vi.fn()} />);
    const el = grip();

    down(el, 400);
    move(el, 100); // 300px up
    up(el);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets between gestures", () => {
    /*
      THE STATE BUG THIS SHAPE INVITES.

      A drag that ended must not leave its distance behind, or the NEXT touch —
      a tap on the handle, which travels nowhere — inherits the last one's
      offset and dismisses the sheet without the user moving.
    */
    const onClose = vi.fn();
    render(<SheetGrip onClose={onClose} onOffset={vi.fn()} />);
    const el = grip();

    down(el, 100);
    move(el, 100 + 150);
    up(el);
    expect(onClose).toHaveBeenCalledTimes(1);

    // A second, tiny gesture.
    down(el, 100);
    move(el, 102);
    up(el);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes the pointer so the drag survives leaving the handle", () => {
    // The gesture's whole point is moving away from where it began, so without
    // capture the events go to whatever is underneath and the sheet stops
    // following halfway down.
    render(<SheetGrip onClose={vi.fn()} onOffset={vi.fn()} />);
    const el = grip();
    down(el, 100);
    expect(el.setPointerCapture).toHaveBeenCalled();
  });

  it("cancelling abandons the drag without closing", () => {
    // A system gesture, a call, a notification. The sheet returns rather than
    // being dismissed by an interruption the user did not choose.
    const onClose = vi.fn();
    const onOffset = vi.fn();
    render(<SheetGrip onClose={onClose} onOffset={onOffset} />);
    const el = grip();

    down(el, 100);
    move(el, 100 + 150);
    fireEvent.pointerCancel(el, { pointerId: 1 });

    expect(onClose).not.toHaveBeenCalled();
    expect(onOffset).toHaveBeenLastCalledWith(0);
  });
});

describe("without a pointer at all", () => {
  it("closes on Enter and Space", () => {
    // The handle looks interactive, so it must be operable by keyboard —
    // otherwise it is a control that exists for some people and not others.
    for (const key of ["Enter", " "]) {
      const onClose = vi.fn();
      render(<SheetGrip onClose={onClose} onOffset={vi.fn()} />);
      fireEvent.keyDown(grip(), { key });
      expect(onClose, `${key} should close`).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("has an accessible name that says what it does", () => {
    render(<SheetGrip onClose={vi.fn()} onOffset={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close contact details/i })).toBeTruthy();
  });
});
