// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import type { LabelWithCountDTO, MailCountsDTO } from "../components/mail/types";

/**
 * The phone nav drawer is out of reach while it is closed.
 *
 * ── THE DEFECT ──
 * Below 768px `.pb-sidebar` is an off-canvas drawer, and closing it only
 * translated it off the left edge. Every link in it stayed in the tab order
 * and the accessibility tree: a keyboard user tabbing from the burger walked
 * through fifty invisible links, and a screen reader read the whole
 * navigation as if it were on screen.
 *
 * ── WHAT IS PINNED ──
 * - CSS: the closed drawer is `visibility: hidden` at phone width (delayed
 *   until the slide-out ends) and visible when open. That works before
 *   hydration and needs no script. Desktop, where the same <nav> is the
 *   always-visible column, is not touched.
 * - Script: `inert` on the closed drawer at phone width only; focus moves in
 *   on open and back to the burger on Escape or a scrim tap; everything
 *   outside the drawer is inert while it is open, and released after.
 *
 * happy-dom evaluates no media queries, so matchMedia is stubbed — and each
 * case asserts on the query string the component asked for, so a changed
 * breakpoint cannot keep passing.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("@/components/AuditedSignOutButton", () => ({ default: () => null }));

import MailNavShell from "../components/mail/MailNavShell";

const counts = {
  all: 7,
  unread: 2,
  awaiting: 1,
  inbox: 5,
  closed: 1,
  sent: 5,
  starred: 0,
  labeled: 5,
  snoozed: 0,
  archived: 1,
  trash: 4,
} satisfies MailCountsDTO;

const labels = [
  { id: 1, name: "Billing", color: "tag_b", colorHex: null, ticketCount: 2 },
] satisfies LabelWithCountDTO[];

/* ── a viewport the test controls ── */
let phone = true;
const asked: string[] = [];
const listeners = new Set<EventListenerOrEventListenerObject>();

function stubMatchMedia() {
  window.matchMedia = ((query: string) => {
    asked.push(query);
    return {
      get matches() {
        return query === "(max-width: 768px)" ? phone : false;
      },
      media: query,
      addEventListener: (_: string, cb: EventListenerOrEventListenerObject) => {
        listeners.add(cb);
      },
      removeEventListener: (_: string, cb: EventListenerOrEventListenerObject) => {
        listeners.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

function resize(toPhone: boolean) {
  phone = toPhone;
  act(() => {
    for (const cb of [...listeners]) {
      const event = new Event("change");
      if (typeof cb === "function") cb(event);
      else cb.handleEvent(event);
    }
  });
}

beforeEach(() => {
  phone = true;
  asked.length = 0;
  listeners.clear();
  stubMatchMedia();
});
afterEach(cleanup);

/** The shell as app/(dashboard)/layout.tsx builds it: nav, then the page. */
function show() {
  const view = render(
    <div className="pb-shell pbm">
      <MailNavShell
        workspaceName="Open Door Bakery"
        userLabel="emma@opendoorbakery.co.uk"
        counts={counts}
        labels={labels}
        canPersonalise
        billing={null}
      />
      <main className="pb-main pbm-main">
        <button type="button">Reply</button>
      </main>
    </div>,
  );
  const q = <T extends Element>(sel: string) => {
    const el = view.container.querySelector<T>(sel);
    expect(el, `${sel} is not in the rendered shell`).not.toBeNull();
    return el!;
  };
  return {
    nav: () => q<HTMLElement>("nav.pb-sidebar"),
    burger: () => q<HTMLButtonElement>(".pbm-burger"),
    main: () => q<HTMLElement>("main"),
    topbar: () => q<HTMLElement>(".pbm-topbar"),
    scrim: () => view.container.querySelector<HTMLElement>(".pb-scrim"),
  };
}

function press(key: string) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("the closed drawer, in the stylesheet", () => {
  const root = postcss.parse(
    readFileSync(join(process.cwd(), "app", "globals.css"), "utf8"),
  );

  /** Declarations for `selector`, merged in source order; inside the phone query or outside every query. */
  function decls(selector: string, inPhoneQuery: boolean) {
    const out = new Map<string, string>();
    root.walkRules((rule) => {
      if (rule.selector !== selector) return;
      const media = rule.parent?.type === "atrule" ? (rule.parent as postcss.AtRule) : null;
      const isPhone = media?.name === "media" && media.params.includes("max-width: 768px");
      const isTop = rule.parent?.type === "root";
      if (inPhoneQuery ? !isPhone : !isTop) return;
      rule.walkDecls((d) => void out.set(d.prop, d.value.replace(/\s+/g, " ").trim()));
    });
    expect(out.size, `no ${selector} rule found — this check is looking at nothing`).toBeGreaterThan(0);
    return out;
  }

  it("is visibility:hidden at phone width, so it leaves the tab order and the accessibility tree", () => {
    expect(decls(".pb-sidebar", true).get("visibility")).toBe("hidden");
  });

  it("is visible again when open", () => {
    expect(decls('.pb-sidebar[data-open="true"]', true).get("visibility")).toBe("visible");
  });

  it("hides only after the slide-out has finished, so closing still animates", () => {
    const transition = decls(".pb-sidebar", true).get("transition") ?? "";
    const slide = /transform (\d*\.?\d+)s/.exec(transition);
    const hide = /visibility 0s \w+ (\d*\.?\d+)s/.exec(transition);
    expect(slide, `no transform transition in "${transition}"`).not.toBeNull();
    expect(hide, `no delayed visibility transition in "${transition}"`).not.toBeNull();
    expect(Number(hide![1])).toBe(Number(slide![1]));
  });

  it("leaves the desktop column visible", () => {
    expect(decls(".pb-sidebar", false).get("visibility")).toBeUndefined();
  });
});

describe("the closed drawer, in the DOM", () => {
  it("is inert at phone width", () => {
    const { nav } = show();
    expect(asked).toContain("(max-width: 768px)");
    expect(nav().hasAttribute("inert")).toBe(true);
  });

  it("is NOT inert on desktop, where it is the visible column", () => {
    phone = false;
    const { nav, main } = show();
    expect(nav().hasAttribute("inert")).toBe(false);
    expect(main().hasAttribute("inert")).toBe(false);
  });

  it("follows the viewport: inert after shrinking to a phone, not after growing back", () => {
    phone = false;
    const { nav } = show();
    resize(true);
    expect(nav().hasAttribute("inert")).toBe(true);
    resize(false);
    expect(nav().hasAttribute("inert")).toBe(false);
  });
});

describe("opening the drawer", () => {
  it("moves focus into it", () => {
    const { nav, burger } = show();
    burger().focus();
    fireEvent.click(burger());
    expect(nav().hasAttribute("inert")).toBe(false);
    expect(nav().contains(document.activeElement), "focus stayed outside the drawer").toBe(true);
  });

  it("makes the page behind it inert, but not the scrim that closes it", () => {
    const { burger, main, topbar, scrim } = show();
    fireEvent.click(burger());
    expect(main().hasAttribute("inert")).toBe(true);
    expect(topbar().hasAttribute("inert")).toBe(true);
    expect(scrim(), "no scrim while open").not.toBeNull();
    expect(scrim()!.hasAttribute("inert")).toBe(false);
  });
});

describe("closing the drawer", () => {
  it("on Escape, returns focus to the burger and releases the page", () => {
    const { nav, burger, main } = show();
    fireEvent.click(burger());
    press("Escape");
    expect(nav().getAttribute("data-open")).toBe("false");
    expect(nav().hasAttribute("inert")).toBe(true);
    expect(main().hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(burger());
  });

  it("on a scrim tap, does the same", () => {
    const { burger, main, scrim } = show();
    fireEvent.click(burger());
    fireEvent.click(scrim()!);
    expect(scrim()).toBeNull();
    expect(main().hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(burger());
  });

  it("when the viewport grows to desktop, so the page cannot stay inert behind a column", () => {
    const { nav, burger, main } = show();
    fireEvent.click(burger());
    expect(main().hasAttribute("inert")).toBe(true);
    resize(false);
    expect(nav().getAttribute("data-open")).toBe("false");
    expect(nav().hasAttribute("inert")).toBe(false);
    expect(main().hasAttribute("inert")).toBe(false);
  });

  it("leaves an element that was already inert alone", () => {
    const { burger, main } = show();
    main().setAttribute("inert", "");
    fireEvent.click(burger());
    press("Escape");
    expect(main().hasAttribute("inert"), "released something it never made inert").toBe(true);
  });
});
