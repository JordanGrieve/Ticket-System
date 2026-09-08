// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AbortPanel } from "../app/(dashboard)/newsletters/Composer";
import type { RecipientStatus } from "../db/schema";

/**
 * Stopping a live send, ACTUALLY EXECUTED.
 *
 * This was the last window.confirm with its own button, and the most
 * consequential question in the product: it can strand part of an audience
 * mid-send. The in-page version has to do by hand what the native one did for
 * free, and every one of those is a line here — including that the numbers a
 * person is deciding on are the ones describeAbort has always named.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/newsletters",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

const recipients = {
  queued: 312,
  sent: 40,
  delivered: 35,
  bounced: 2,
  complained: 1,
  // Not in the first draft; `satisfies` named it at typecheck, which is the
  // whole argument for saying what a fixture is.
  failed: 0,
} satisfies Record<RecipientStatus, number>;

function show(over: Partial<Parameters<typeof AbortPanel>[0]> = {}) {
  const onAbort = vi.fn();
  render(
    <AbortPanel
      state={{ kind: "idle" }}
      recipients={recipients}
      stalled={false}
      onAbort={onAbort}
      {...over}
    />,
  );
  return onAbort;
}

const stopButton = () => screen.getByRole("button", { name: /stop this campaign/i });

describe("asking before stopping", () => {
  it("does nothing until the question is answered", () => {
    const onAbort = show();
    fireEvent.click(stopButton());
    expect(onAbort).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: /stop this campaign/i })).toBeTruthy();
  });

  it("names the people already mailed and still queued — describeAbort's numbers", () => {
    show();
    fireEvent.click(stopButton());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toMatch(/78 people have already been sent this/);
    expect(dialog.textContent).toMatch(/312 people are still queued/);
    expect(dialog.textContent).toMatch(/cannot be undone/i);
  });

  it("says so when the counts could not be read", () => {
    show({ recipients: null });
    fireEvent.click(stopButton());
    expect(screen.getByRole("alertdialog").textContent).toMatch(/couldn’t read how many/i);
  });

  it("focuses Keep sending, not Stop", () => {
    show();
    fireEvent.click(stopButton());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep sending" }));
  });

  it("Escape backs out and focus returns to the button", () => {
    show();
    fireEvent.click(stopButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(stopButton());
  });

  it("Keep sending backs out the same way", () => {
    const onAbort = show();
    fireEvent.click(stopButton());
    fireEvent.click(screen.getByRole("button", { name: "Keep sending" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onAbort).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(stopButton());
  });

  it("Stop it for good is the only path to onAbort", () => {
    const onAbort = show();
    fireEvent.click(stopButton());
    fireEvent.click(screen.getByRole("button", { name: /stop it for good/i }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cannot be asked again while a stop is in flight", () => {
    show({ state: { kind: "working" } });
    // The label changes while it works, so it is found by the working label.
    const btn = screen.getByRole("button", { name: /stopping/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});
