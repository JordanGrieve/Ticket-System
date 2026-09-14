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
 * 14 Sep 2026 — "a third of the size unless they hit show more". It went to
 * three lines, which turned out to be too far the other way: the box read as a
 * label and said nothing about what the prompt does. It sits at fifteen lines,
 * with the opener that carries the client's own business name and the endpoint.
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
 *
 * ── THE PART THAT HAS TO BE RIGHT ──
 * clientHeight depends on `is-clipped`, because in a browser it does: the cap
 * is a stylesheet rule on that class, so an unclipped block has no cap and its
 * two heights are EQUAL. The first version of this stub returned 2000 and 300
 * whenever it saw a code block, clipped or not — a browser cannot produce that,
 * and under it a component that waits to detect overflow before clipping looks
 * like it works. One did. It shipped, every prompt on the live page stood at
 * full height with no Show more anywhere, and all ten tests here were green.
 */
function makeEverythingOverflow() {
  const isBlock = (el: { className?: string }) =>
    el.className?.includes?.("sti-code-clip") ?? false;
  const isClipped = (el: { className?: string }) =>
    el.className?.includes?.("is-clipped") ?? false;

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return isBlock(this) ? 2000 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      if (!isBlock(this)) return 0;
      // Capped only while the class is on — 300px, what the stylesheet says.
      // Uncapped, the box is as tall as its content and overflows by nothing.
      return isClipped(this) ? 300 : 2000;
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

/*
  The contact section's second mode. It is queried by its FULL accessible name
  on purpose: both sections used to offer a toggle reading just "No code", and
  `/^No code$/` matched the pair — the newsletter's is "Just a link" now and
  each name says which form it wires up, so a single getByRole resolves. If this
  query ever finds two again, the labels have collapsed back together and the
  duplicate-name test below is about to go red for the same reason.
*/
const noCodeToggle = () =>
  screen.getByRole("button", { name: /^No code — point your contact form/i });

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

  it("puts the opener beside Copy snippet, to its left", () => {
    /*
     * Where the control IS, not just that it exists. It spent two revisions
     * under the block, which at 300px of code puts it below the fold on a
     * phone — a button you have to scroll to in order to learn there is more
     * to scroll to. Jordan, 14 Sep 2026: "next to copy snippet on the left".
     */
    makeEverythingOverflow();
    show();

    const row = document.querySelector(".sti-code-copy");
    expect(row, "the code panel has no control row").not.toBeNull();

    const buttons = [...row!.querySelectorAll("button")];
    expect(
      buttons.map((b) => (b.textContent ?? "").trim()),
      "the opener is not in the row with Copy, or is not first in it",
    ).toEqual(["Show more code", "Copy snippet"]);
  });

  it("COPIES THE WHOLE THING while still collapsed", async () => {
    /*
     * The one that would fail silently. A collapsed block shows three of
     * seventy lines; if copy read the DOM instead of the source string, an
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

describe("the No-code form is never collapsed", () => {
  /*
   * The clip is 92px — three lines. That is right for a seventy-line prompt
   * nobody reads and WRONG for the six-line form in the No-code mode, which is
   * meant to be taken whole; hiding half of it behind a button hides the thing
   * itself. So collapsing is opted into per block, not decided by height.
   *
   * This has to force overflow to mean anything. Without the stub happy-dom
   * lays nothing out, every block measures zero, and the assertion passes
   * whether or not the opt-in exists — which is exactly how the six-line form
   * came to be clipped in the browser while the suite stayed green.
   */
  it("stays whole even when it would overflow", () => {
    makeEverythingOverflow();
    show();

    // Switch the contact section to its No-code mode.
    fireEvent.click(noCodeToggle());

    const contactClip = clips()[0];
    expect(
      contactClip?.className,
      "the pasteable form was clipped — it is meant to be copied whole",
    ).not.toContain("is-clipped");
  });

  it("and offers no Show more of its own", () => {
    makeEverythingOverflow();
    show();
    fireEvent.click(noCodeToggle());
    // Only the newsletter prompt's button should remain.
    expect(moreButtons()).toHaveLength(1);
  });
});

describe("every control on the page has its own name", () => {
  /*
   * ── THE DEFECT ──
   *
   * Two sections offer the same two choices, so the page rendered two buttons
   * named "✨ AI prompt (recommended)" and two named "No code". A sighted
   * person tells them apart by the heading above each. Anyone LISTING the
   * controls — a screen reader's control list, voice control saying "click AI
   * prompt" — got two identical names and no way to pick.
   *
   * Found on 14 Sep 2026 by a test that could not query a button, which is a
   * better detector for this than reading the markup: if the test cannot say
   * which one it means, neither can a person.
   */
  it("no two buttons share an accessible name", () => {
    show();
    const names = screen
      .getAllByRole("button")
      .map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim())
      .filter(Boolean);

    const seen = new Map<string, number>();
    for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([name]) => name);

    expect(
      duplicates,
      `these names appear on more than one control: ${duplicates.join(", ")}`,
    ).toEqual([]);
  });

  it("each toggle's accessible name CONTAINS its visible text (WCAG 2.5.3)", () => {
    /*
     * Label in Name. An aria-label that replaces the visible words rather than
     * extending them breaks voice control: the button reads "No code", the
     * user says "click No code", and nothing happens because the accessible
     * name is "Point your form at Postbox". Every label here has to keep the
     * written words intact.
     */
    show();
    for (const button of document.querySelectorAll(".sti-mode")) {
      const visible = (button.textContent ?? "").replace(/[✨]/g, "").trim();
      const accessible = button.getAttribute("aria-label") ?? "";
      expect(accessible, `${visible} has no aria-label`).not.toBe("");
      expect(
        accessible.toLowerCase(),
        `"${accessible}" does not contain its visible text "${visible}"`,
      ).toContain(visible.toLowerCase());
    }
  });

  it("and each one names the section it belongs to", () => {
    // The point of the label. "AI prompt" twice is the bug; naming the form
    // each one wires up is the fix.
    show();
    const labels = [...document.querySelectorAll(".sti-mode")].map(
      (b) => b.getAttribute("aria-label") ?? "",
    );
    expect(labels.filter((l) => /contact form/i.test(l))).toHaveLength(2);
    expect(labels.filter((l) => /newsletter|signup page/i.test(l))).toHaveLength(2);
  });
});
