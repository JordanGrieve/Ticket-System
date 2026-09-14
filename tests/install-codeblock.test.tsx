// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InstallView from "../components/InstallView";

/**
 * The install page's snippets are collapsed until somebody asks for the rest.
 *
 * ── WHY ──
 * Both sections lead with an AI prompt now, and a prompt is seventy lines
 * written for a machine. At full height it is the whole screen: the steps
 * around it, the newsletter section and the key rotation all get pushed off,
 * and a client scrolls past text they were never meant to read. Jordan,
 * 14 Sep 2026 — "a third of the size unless they hit show more".
 *
 * ── THE ASSERTION THAT MATTERS ──
 * Copy has to take the WHOLE prompt while the block is collapsed. The obvious
 * implementation — read the rendered text — hands somebody a third of a prompt
 * and looks like it worked, and the failure surfaces on THEIR website, wired up
 * by an assistant working from truncated instructions.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/settings/install",
  useSearchParams: () => new URLSearchParams(),
}));

/*
  scrollHeight and clientHeight are stubbed onto HTMLElement.prototype below,
  and a prototype patch outlives the test that made it. Left in place it leaked
  into the short-snippet case and made every block report itself as overflowing
  — a failure that looks like a bug in the component and is not.
*/
const ORIGINAL = {
  scrollHeight: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  ),
  clientHeight: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  ),
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const key of ["scrollHeight", "clientHeight"] as const) {
    const original = ORIGINAL[key];
    if (original) Object.defineProperty(HTMLElement.prototype, key, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});

/**
 * happy-dom lays nothing out, so scrollHeight and clientHeight are both 0 and
 * nothing ever overflows. The measurement is the component's job, not this
 * file's — these tests stub the two properties so the clipped branch is
 * reachable at all, and assert on what the component DOES with the answer.
 */
function makeEverythingOverflow() {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.className?.includes?.("sti-code-clip") ? 2000 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      // Any value below the scrollHeight above would do — the component only
      // compares the two. 300 because that is what the stylesheet caps a
      // clipped block at, so a reader is not left thinking the number is
      // arbitrary when it happens to match, or authoritative when it does not.
      return this.className?.includes?.("sti-code-clip") ? 300 : 0;
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
}

function show() {
  render(
    <InstallView
      apiKey="cli_testkey"
      inboundEmail="amoria-f48ea9@postbox.help"
      replyFrom={'"AMORIA" <replies@postbox.help>'}
      workspaceName="AMORIA"
      appUrl="https://postbox.help"
      subscribeEndpoint="https://postbox.help/api/subscribe/cli_testkey"
      hostedSignupUrl="https://postbox.help/s/cli_testkey"
      honeypotFields={["website", "company"]}
    />,
  );
}

/*
  There are two code blocks on this page — the contact prompt and the
  newsletter prompt — so every query here is scoped to the first. An unscoped
  `getByRole("button", { name: /show more/i })` throws on finding two, which is
  how this file learned that both sections got the treatment.
*/
const clips = () => [...document.querySelectorAll(".sti-code-clip")];
const clip = () => clips()[0];
const moreButtons = () => screen.queryAllByRole("button", { name: /show more/i });
const moreButton = () => moreButtons()[0] ?? null;

describe("a long prompt", () => {
  it("is clipped on arrival, not shown in full", () => {
    makeEverythingOverflow();
    show();
    expect(clip()?.className).toContain("is-clipped");
  });

  it("applies to BOTH the contact prompt and the newsletter one", () => {
    // Jordan asked for both sections. One collapsed and one not would be the
    // easy half-fix, and it would look done from the top of the page.
    makeEverythingOverflow();
    show();
    expect(clips()).toHaveLength(2);
    for (const c of clips()) expect(c.className).toContain("is-clipped");
    expect(moreButtons()).toHaveLength(2);
  });

  it("offers a way to see the rest", () => {
    makeEverythingOverflow();
    show();
    expect(moreButton()).not.toBeNull();
    expect(moreButton()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens, and closes again", () => {
    makeEverythingOverflow();
    show();
    fireEvent.click(moreButton()!);
    expect(clip()?.className).not.toContain("is-clipped");

    const less = screen.getAllByRole("button", { name: /show less/i })[0];
    expect(less.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(less);
    expect(clip()?.className).toContain("is-clipped");
  });

  it("COPIES THE WHOLE THING while still collapsed", async () => {
    /*
     * The one that would fail silently. A collapsed block shows perhaps fifteen
     * of seventy lines; if copy read the DOM instead of the source string, an
     * assistant would be handed a prompt that stops mid-sentence and would wire
     * up somebody's contact form from it.
     */
    makeEverythingOverflow();
    // Typed, so `mock.calls[0][0]` is a string rather than an error. A bare
    // `vi.fn(async () => {})` records the call but declares no parameters, and
    // reading the copied text off it does not compile.
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    show();

    expect(clip()?.className, "not collapsed, so this proves nothing").toContain(
      "is-clipped",
    );

    fireEvent.click(screen.getAllByRole("button", { name: /copy snippet/i })[0]);

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    // The prompt's first line and its LAST instruction both have to be there.
    expect(copied).toContain("You are helping integrate");
    expect(copied).toContain("Integration test");
    expect(copied.split("\n").length).toBeGreaterThan(40);
  });
});

describe("a short snippet", () => {
  it("is not clipped, and grows no button", () => {
    /*
     * The contact section's other mode is a six-line form, through the same
     * component. A "Show more" under content that is entirely visible is a
     * control that lies about there being something behind it — so the
     * component measures rather than assuming every block is long.
     *
     * Nothing is stubbed here: with no layout, nothing overflows, which is the
     * same answer the browser gives for six lines.
     */
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    show();
    expect(clip()?.className).not.toContain("is-clipped");
    expect(moreButton()).toBeNull();
  });
});
