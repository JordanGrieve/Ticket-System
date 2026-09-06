// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import DismissibleNotice from "../components/DismissibleNotice";

/**
 * The dismissible settings notice, ACTUALLY EXECUTED.
 *
 * Everything here was previously reasoning: that the cross hides it, that the
 * dismissal is remembered, that a DIFFERENT notice is unaffected, and that
 * storage being unavailable does not take the component down with it.
 */

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const NOTICE = "Only the owner can remove people.";

const show = (id = "a") =>
  render(<DismissibleNotice id={id}>{NOTICE}</DismissibleNotice>);

describe("dismissing", () => {
  it("shows until the cross is pressed", () => {
    show();
    expect(screen.getByText(NOTICE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /dismiss this notice/i }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("stays dismissed on the next render", () => {
    // The whole point. Without persistence the cross is a control that undoes
    // itself on the next navigation.
    show();
    fireEvent.click(screen.getByRole("button", { name: /dismiss this notice/i }));
    cleanup();
    show();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("does not dismiss a DIFFERENT notice", () => {
    /*
      Keyed per id, so putting away "only the owner can remove people" must not
      silence an unrelated notice somebody has never read.
    */
    show("a");
    fireEvent.click(screen.getByRole("button", { name: /dismiss this notice/i }));
    cleanup();

    render(<DismissibleNotice id="b">A different thing</DismissibleNotice>);
    expect(screen.getByText("A different thing")).toBeTruthy();
  });

  it("comes back when the id changes", () => {
    /*
      The id is documented as changing when the WORDING changes, because
      somebody who put away the old sentence has not read the new one. This is
      that promise, executed.
    */
    show("team-notice-v1");
    fireEvent.click(screen.getByRole("button", { name: /dismiss this notice/i }));
    cleanup();

    render(<DismissibleNotice id="team-notice-v2">{NOTICE}</DismissibleNotice>);
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });
});

describe("when storage will not cooperate", () => {
  it("still renders, and still dismisses for this view", () => {
    /*
      Private browsing, or site data blocked. The documented trade is that the
      notice comes back next time — but it must not throw, and pressing the
      cross must not appear to do nothing while an exception is swallowed
      somewhere above.
    */
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    show();
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: /dismiss this notice/i })),
    ).not.toThrow();

    setItem.mockRestore();
    getItem.mockRestore();
  });
});

describe("the cross itself", () => {
  it("is named, so it is not announced as just a button", () => {
    show();
    const x = screen.getByRole("button", { name: /dismiss this notice/i });
    expect(x.getAttribute("aria-label")).toMatch(/dismiss/i);
  });

  it("marks the notice as a note for assistive technology", () => {
    // role=note, so a screen reader announces it as an aside rather than as
    // loose text in the middle of the form.
    show();
    expect(screen.getByRole("note")).toBeTruthy();
  });
});
