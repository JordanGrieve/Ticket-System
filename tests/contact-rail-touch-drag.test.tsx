// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import ContactRail from "../components/mail/ContactRail";
import type { ContactCard } from "../components/mail/types";

/**
 * Dragging the contact sheet down FROM ITS BODY, with a thumb.
 *
 * tests/sheet-grip.test.tsx covers the grip's pointer handlers and
 * tests/sheet-drag.test.ts covers the rule that decides scroll-or-drag. This
 * covers the wiring in ContactRail that had never run: the raw touch
 * listeners, the preventDefault that claims the gesture, the transform the
 * sheet is given, and the close on release.
 *
 * Raw listeners, so the events here are real TouchEvents dispatched on the
 * <aside>, not fireEvent shorthands — the component registers them with
 * addEventListener and a non-passive touchmove, which React's synthetic
 * layer cannot see. happy-dom runs them; it does not scroll, so scrollTop is
 * set by hand to stand for "there is content above".
 */

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(cleanup);

const contact = {
  name: "Marcus Bell",
  email: "marcus.bell@outlook.com",
  firstSeenIso: "2026-08-17T09:00:00.000Z",
  ticketCount: 1,
} satisfies Partial<ContactCard> as ContactCard;

function sheet(): HTMLElement {
  const el = document.querySelector("aside.pbm-rail");
  expect(el, "the sheet did not render").not.toBeNull();
  return el as HTMLElement;
}

/**
 * A single-finger touch at (x, y), on `target`, bubbling to the sheet.
 * happy-dom's TouchEvent accepts a touches list; each entry only needs the
 * coordinates the handlers read.
 */
function touch(type: string, target: Element, x: number, y: number) {
  const ev = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === "touchend" ? [] : [{ clientX: x, clientY: y } as Touch],
  });
  // act(): the listeners are raw, so React is not already inside an event
  // when setDragY runs, and the transform would not be flushed before the
  // assertion reads it.
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

describe("pulling the sheet down from its body", () => {
  it("moves the sheet with the finger when the body is at its top", () => {
    render(<ContactRail contact={contact} state="open" onClose={vi.fn()} />);
    const el = sheet();
    el.scrollTop = 0;

    touch("touchstart", el, 100, 300);
    const move = touch("touchmove", el, 100, 360);

    // Claimed: the browser is told not to scroll, and the sheet follows.
    expect(move.defaultPrevented).toBe(true);
    expect(el.style.transform).toBe("translateY(60px)");
    expect(el.dataset.dragging).toBe("true");
  });

  it("closes on release past the threshold, and puts the sheet back", () => {
    const onClose = vi.fn();
    render(<ContactRail contact={contact} state="open" onClose={onClose} />);
    const el = sheet();
    el.scrollTop = 0;

    touch("touchstart", el, 100, 300);
    touch("touchmove", el, 100, 450);
    touch("touchend", el, 100, 450);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(el.style.transform).toBe("");
  });

  it("springs back without closing on a short pull", () => {
    const onClose = vi.fn();
    render(<ContactRail contact={contact} state="open" onClose={onClose} />);
    const el = sheet();
    el.scrollTop = 0;

    touch("touchstart", el, 100, 300);
    touch("touchmove", el, 100, 340);
    touch("touchend", el, 100, 340);

    expect(onClose).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("");
  });

  it("leaves a pull to the scroller when there is content above", () => {
    render(<ContactRail contact={contact} state="open" onClose={vi.fn()} />);
    const el = sheet();
    el.scrollTop = 80;

    touch("touchstart", el, 100, 300);
    const move = touch("touchmove", el, 100, 400);

    // Not claimed: the browser scrolls, the sheet stays where it is.
    expect(move.defaultPrevented).toBe(false);
    expect(el.style.transform).toBe("");
  });

  it("does not double-handle a touch that began on the grip", () => {
    render(<ContactRail contact={contact} state="open" onClose={vi.fn()} />);
    const el = sheet();
    el.scrollTop = 0;
    const grip = el.querySelector(".pbm-rail-grip");
    expect(grip, "the grip did not render").not.toBeNull();

    touch("touchstart", grip as Element, 100, 300);
    const move = touch("touchmove", grip as Element, 100, 360);

    // The grip's pointer handlers own this one; the body listeners stand
    // aside, so the sheet is not moved twice for one finger.
    expect(move.defaultPrevented).toBe(false);
  });

  it("never closes when the system takes the touch away", () => {
    const onClose = vi.fn();
    render(<ContactRail contact={contact} state="open" onClose={onClose} />);
    const el = sheet();
    el.scrollTop = 0;

    touch("touchstart", el, 100, 300);
    touch("touchmove", el, 100, 500);
    touch("touchcancel", el, 100, 500);

    expect(onClose).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("");
  });
});
