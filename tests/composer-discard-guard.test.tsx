// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Composer from "../app/(dashboard)/newsletters/Composer";
import type { CampaignRowDTO } from "../app/(dashboard)/newsletters/Composer";

/**
 * Leaving unsaved edits, ACTUALLY EXECUTED.
 *
 * The last window.confirm in the client, and the one whose header argued it
 * had to stay: a synchronous gate on a navigation with two callers. The
 * conversion parks the call and replays it, and these lines are what that
 * has to get right — nothing is lost on Keep editing, the parked action
 * really runs on Discard, and a clean draft never asks at all.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/newsletters",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const campaign = {
  id: 7,
  name: "Christmas orders are open",
  subject: "Order by the 12th",
  status: "draft",
  // Lists were retired; no real row carries one. See the fixture note in
  // tests/newsletter-views-render.test.tsx.
  listId: null,
  listName: null,
  recipientCount: 118,
  updatedAtIso: "2026-09-06T10:00:00.000Z",
  sentAtIso: null,
} satisfies CampaignRowDTO;

function show() {
  render(
    <Composer
      initialCampaigns={[campaign]}
      workspaceName="Open Door Bakery"
      legalName={null}
      postalAddress={null}
      brandAccentHex={null}
      brandSignOff={null}
      appUrl="https://postbox.help"
      viewerEmail="hello@opendoorbakery.co.uk"
      recipientsPerSweep={250}
    />,
  );
}

const nameField = () => screen.getByLabelText("Campaign name") as HTMLInputElement;
const newButton = () => screen.getByRole("button", { name: "New" });
const dirty = () => fireEvent.change(nameField(), { target: { value: "Spring menu" } });

describe("a clean draft never asks", () => {
  it("New just starts a new draft", () => {
    show();
    fireEvent.click(newButton());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("unsaved edits", () => {
  it("New asks first, and keeps the edits on Keep editing", () => {
    show();
    dirty();
    // A real press focuses the button; fireEvent.click alone does not.
    newButton().focus();
    fireEvent.click(newButton());
    const dialog = screen.getByRole("alertdialog", { name: /unsaved changes/i });
    expect(dialog.textContent).toMatch(/starting a new one/i);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(nameField().value).toBe("Spring menu");
    // Focus goes back to what was pressed.
    expect(document.activeElement).toBe(newButton());
  });

  it("Escape is Keep editing", () => {
    show();
    dirty();
    fireEvent.click(newButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(nameField().value).toBe("Spring menu");
  });

  it("Discard changes replays the parked New", () => {
    show();
    dirty();
    fireEvent.click(newButton());
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(nameField().value).toBe("");
  });

  it("opening another campaign asks the same question and replays the open", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      requested: url,
      ok: true,
      json: async () => ({ campaign: { ...campaign, body: "", preheader: "" }, recipients: null }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    show();
    dirty();
    fireEvent.click(screen.getByRole("button", { name: /christmas orders are open/i }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/opening another one/i);
    // Parked: nothing was fetched yet.
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/campaigns/7");
  });
});
