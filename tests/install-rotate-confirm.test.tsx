// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import InstallView from "../components/InstallView";

/**
 * The rotate-key confirm, ACTUALLY EXECUTED.
 *
 * Everything a native confirm() did for free and the in-page one has to do by
 * hand: the question replaces the button, Cancel takes focus rather than the
 * destructive action, Esc backs out, focus goes back to where it was, and the
 * outcome is narrated to a screen reader. Each of those was reasoning until
 * 8 Sep 2026; each is a line here now.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {}, replace: () => {} }),
}));

afterEach(cleanup);
beforeEach(() => {
  refresh.mockClear();
});

function show() {
  return render(
    <InstallView
      apiKey="pbk_live_test"
      inboundEmail="in@postbox.help"
      replyFrom='"Open Door Bakery" <replies@postbox.help>'
      workspaceName="Open Door Bakery"
      appUrl="https://postbox.help"
      subscribeEndpoint="https://postbox.help/api/subscribe/pbk_live_test"
      hostedSignupUrl="https://postbox.help/s/pbk_live_test"
      honeypotFields={["website", "company"]}
    />,
  );
}

const rotateButton = () => screen.getByRole("button", { name: /rotate key/i });

describe("asking the question", () => {
  it("replaces the button with an alertdialog and focuses Cancel, not Rotate", () => {
    show();
    fireEvent.click(rotateButton());
    const dialog = screen.getByRole("alertdialog", { name: /rotate the api key/i });
    expect(dialog).toBeTruthy();
    // The consequence sits beside the control, in the dialog's own description.
    expect(dialog.getAttribute("aria-describedby")).toBe("sti-confirm-q");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("Escape backs out and focus returns to the rotate button", () => {
    show();
    fireEvent.click(rotateButton());
    expect(screen.queryByRole("alertdialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(rotateButton());
  });

  it("Cancel does the same", () => {
    show();
    fireEvent.click(rotateButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(rotateButton());
  });

  it("does not listen for Escape while the question is closed", () => {
    show();
    // Nothing to close: the key must pass through to whatever else wants it.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rotateButton()).toBeTruthy();
  });
});

describe("the outcome is narrated", () => {
  it("announces a successful rotation and refreshes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    show();
    fireEvent.click(rotateButton());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /rotate the key/i }));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toMatch(/api key rotated/i);
    expect(screen.queryByRole("alert")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("reports a failure inline, announces it, and rotates nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    show();
    fireEvent.click(rotateButton());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /rotate the key/i }));
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/still working/i);
    expect(screen.getByRole("status").textContent).toMatch(/was not rotated/i);
    // The control is back, and usable again.
    expect(rotateButton().hasAttribute("disabled")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("the live region exists before it has anything to say", () => {
    // A region mounted at the same moment as its text is routinely missed.
    show();
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
