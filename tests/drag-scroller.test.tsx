// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import DragScroller from "../components/DragScroller";

/**
 * Drag-to-scroll, ACTUALLY EXECUTED.
 *
 * tests/drag-scroll.test.ts covers the two rules. This covers the wiring: that
 * a click still navigates, that a drag suppresses it, and that touch is left
 * alone so this never fights the native scrolling that already works.
 *
 * ── THE ONE THING A DOM CANNOT GIVE US ──
 * happy-dom has no layout, so scrollWidth and clientWidth are both 0 and the
 * component's "is there anything to scroll" guard would refuse every drag.
 * They are defined per test, which is honest about what is being tested: the
 * DECISIONS, given a strip that overflows — not the browser's scrolling.
 */

afterEach(cleanup);

function strip(overflowing = true) {
  const el = screen.getByTestId("strip");
  Object.defineProperty(el, "scrollWidth", { value: overflowing ? 800 : 100, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 100, configurable: true });
  el.setPointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => false);
  el.scrollLeft = 0;
  return el;
}

const mouse = { pointerId: 1, pointerType: "mouse" as const };

function renderStrip(onClick = vi.fn()) {
  render(
    <DragScroller className="s" data-testid="strip">
      <a href="/settings/team" onClick={onClick}>
        Team
      </a>
    </DragScroller>,
  );
  return onClick;
}

describe("dragging with a mouse", () => {
  it("scrolls the strip the opposite way to the pointer", () => {
    renderStrip();
    const el = strip();

    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    fireEvent.pointerMove(el, { ...mouse, clientX: 220 });

    // Dragged 80px left, so the content moves left and scrollLeft goes up.
    expect(el.scrollLeft).toBe(80);
  });

  it("does not move below the slop", () => {
    renderStrip();
    const el = strip();
    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    fireEvent.pointerMove(el, { ...mouse, clientX: 298 });
    expect(el.scrollLeft).toBe(0);
  });

  it("takes the pointer once the drag is real, and not before", () => {
    /*
      Capturing on pointerdown would be simpler and wrong: it swallows the
      click of a plain tap. So capture waits until the slop is crossed.
    */
    renderStrip();
    const el = strip();

    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    expect(el.setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerMove(el, { ...mouse, clientX: 200 });
    expect(el.setPointerCapture).toHaveBeenCalled();
  });

  it("refuses to start when there is nothing to scroll", () => {
    // A strip narrower than its container. Dragging it should do nothing at
    // all rather than fight a scroll position that cannot move.
    renderStrip();
    const el = strip(false);
    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    fireEvent.pointerMove(el, { ...mouse, clientX: 100 });
    expect(el.scrollLeft).toBe(0);
  });
});

describe("the links still work", () => {
  it("lets a plain click through", () => {
    /*
      THE PROPERTY THAT MATTERS MOST.

      Every child of this strip is a Link. A drag-scroller that eats clicks
      turns the settings tabs into decoration — it would scroll beautifully
      and navigate nowhere, which is worse than not scrolling.
    */
    const onClick = renderStrip();
    const el = strip();

    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    fireEvent.pointerUp(el, { ...mouse });
    fireEvent.click(screen.getByText("Team"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets a click through after a movement inside the slop", () => {
    // Nobody presses a link without moving a pixel or two.
    const onClick = renderStrip();
    const el = strip();

    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    fireEvent.pointerMove(el, { ...mouse, clientX: 302 });
    fireEvent.pointerUp(el, { ...mouse });
    fireEvent.click(screen.getByText("Team"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("suppresses the click that ends a real drag", () => {
    // Letting go after dragging must not navigate to whatever the finger
    // happened to be over.
    const onClick = renderStrip();
    const el = strip();

    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    fireEvent.pointerMove(el, { ...mouse, clientX: 180 });
    fireEvent.pointerUp(el, { ...mouse });
    fireEvent.click(screen.getByText("Team"));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("navigates again on the NEXT click after a drag", () => {
    /*
      The reset that is easy to forget. If the travel distance survives the
      click that consumed it, every subsequent tap is swallowed too and the
      tabs stop working entirely after one drag.
    */
    const onClick = renderStrip();
    const el = strip();

    fireEvent.pointerDown(el, { ...mouse, clientX: 300 });
    fireEvent.pointerMove(el, { ...mouse, clientX: 180 });
    fireEvent.pointerUp(el, { ...mouse });
    fireEvent.click(screen.getByText("Team"));
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Team"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("touch is left alone", () => {
  it("ignores a touch pointer entirely", () => {
    // Native touch scrolling already works and is better than anything
    // reimplemented here; this must not race it.
    renderStrip();
    const el = strip();

    fireEvent.pointerDown(el, { pointerId: 2, pointerType: "touch", clientX: 300 });
    fireEvent.pointerMove(el, { pointerId: 2, pointerType: "touch", clientX: 100 });

    expect(el.scrollLeft).toBe(0);
    expect(el.setPointerCapture).not.toHaveBeenCalled();
  });
});
