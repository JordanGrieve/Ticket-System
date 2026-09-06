// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import ContactRail from "../components/mail/ContactRail";

/**
 * Escape closes the contact rail, and only while it is a sheet.
 *
 * ── THE GATE IS THE PART WORTH TESTING ──
 * "Escape closes it" is one line and hard to get wrong. The condition around
 * it is not: above 1180px the rail is a column with no scrim, and binding
 * Escape there would swallow a key that belongs to the browser and the page.
 * Both halves are asserted, because a handler that always fires would pass a
 * test that only checked the closing half.
 *
 * happy-dom has no layout engine and its matchMedia does not evaluate widths,
 * so the query is stubbed. That makes the stub the thing under test as much as
 * the component — which is why each case asserts on the query STRING the
 * component asked for, not just on the boolean it was handed. A component that
 * quietly changed its breakpoint would otherwise keep passing.
 */

const asked: string[] = [];

function setViewport(matches: boolean) {
  asked.length = 0;
  window.matchMedia = ((query: string) => {
    asked.push(query);
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

const contact = {
  name: "Margarethe Van Der Berg-Whitmore",
  email: "margarethe@example.co.uk",
  firstSeenIso: "2026-01-04T09:00:00.000Z",
  ticketCount: 7,
} as never;

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

beforeEach(() => setViewport(true));
afterEach(cleanup);

describe("Escape closes the contact rail", () => {
  it("closes it when it is an overlay", () => {
    const onClose = vi.fn();
    render(<ContactRail contact={contact} state="open" onClose={onClose} />);
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks about the breakpoint mail.css actually uses", () => {
    // If someone changes the CSS breakpoint and not this one, the rail starts
    // swallowing Escape on desktop — silently, and only for keyboard users.
    render(<ContactRail contact={contact} state="open" onClose={vi.fn()} />);
    expect(asked).toContain("(max-width: 1180px)");
  });

  it("leaves Escape alone when the rail is a column", () => {
    setViewport(false); // wide: no scrim, nothing covering the page
    const onClose = vi.fn();
    render(<ContactRail contact={contact} state="open" onClose={onClose} />);
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when the rail is closed", () => {
    const onClose = vi.fn();
    render(<ContactRail contact={contact} state="closed" onClose={onClose} />);
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    render(<ContactRail contact={contact} state="open" onClose={onClose} />);
    press("Enter");
    press("a");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening once it unmounts", () => {
    // A listener left on document would keep closing a rail that is gone, and
    // would pile up one per open.
    const onClose = vi.fn();
    const { unmount } = render(
      <ContactRail contact={contact} state="open" onClose={onClose} />,
    );
    unmount();
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the close button is still there and is not the only way out", () => {
    // The reason this was never a 2.1.1 failure. If it ever disappears, the
    // Escape handler above becomes load-bearing rather than a convenience.
    const { container } = render(
      <ContactRail contact={contact} state="open" onClose={vi.fn()} />,
    );
    const close = container.querySelector(".pbm-rail-close");
    expect(close).toBeTruthy();
    expect(close!.getAttribute("aria-label")).toBe("Hide contact details");
  });
});
