import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two interaction states that were missing on 27 Sep 2026, and the reason each
 * was missing — which is the part a guard is for.
 *
 *  1. The copy button had no hover. Not because nobody wrote one: its whole
 *     drawing lived in a React `style` object, and a style attribute CANNOT
 *     express :hover. There was no value to change. The guard is therefore on
 *     the cause — the component must carry a class — not on the symptom.
 *
 *  2. The contact rail had no open/close animation, because it is hidden with
 *     `display: none` and display is not an animatable property. The fix is
 *     transition-behavior: allow-discrete plus @starting-style; drop either
 *     half and the animation silently stops existing again.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const copyButton = read("components", "CopyButton.tsx");
const globals = read("app", "globals.css");
const mail = read("app", "mail.css");

describe("the copy button's hover state", () => {
  it("is styled by a class, not a style attribute", () => {
    expect(copyButton).toContain('className={`pb-copy');
    expect(
      copyButton,
      "CopyButton is back on inline styles. A style attribute cannot express " +
        ":hover, so this is not a formatting preference — it is the hover " +
        "state going away again. See app/globals.css .pb-copy.",
    ).not.toMatch(/style=\{\{/);
  });

  it("globals.css gives .pb-copy a hover", () => {
    expect(globals).toMatch(/\.pb-copy:hover\s*\{/);
  });

  it("the copied confirmation outranks the hover", () => {
    // Both selectors, or hovering a button that has just said "Copied" repaints
    // it to the neutral hover colours and takes the answer away.
    expect(globals).toContain(".pb-copy[data-copied]:hover");
  });
});

describe("the contact rail's open and close animation", () => {
  it("transitions display with allow-discrete", () => {
    /*
      Without this the rail goes from display:none to displayed in one frame
      and the opacity and transform either side of it are never seen — which
      is exactly the state this was in before 27 Sep 2026.
    */
    expect(mail).toMatch(/display\s+\d+ms\s+allow-discrete/);
  });

  it("has a @starting-style for the open state, so it animates IN as well as out", () => {
    // `@starting-style {`, not the bare word: the comment above the rule
    // explains the mechanism by name, and a guard that counts prose is a guard
    // that passes with the rule deleted.
    const starts = mail.match(/@starting-style\s*\{/g) ?? [];
    expect(
      starts.length,
      "no @starting-style left in mail.css — the rail now animates out and " +
        "appears instantly, which is half the thing that was asked for",
    ).toBeGreaterThan(0);
    // Every one of them must name the open state; a starting style on the
    // hidden state is a no-op that looks like it is doing something.
    for (const block of mail.split(/@starting-style\s*\{/).slice(1)) {
      expect(block.slice(0, 200)).toContain('.pbm-rail[data-rail="open"]');
    }
  });

  it("the drag still wins over the transition", () => {
    // A sheet that eases toward the finger trails it. The phone block turns the
    // transition off while a drag is in flight, and that rule predates this.
    expect(mail).toMatch(/\.pbm-rail\[data-dragging\]\s*\{\s*transition:\s*none/);
  });

  it("the close button has a hover too", () => {
    expect(mail).toMatch(/\.pbm-rail-close:hover\s*\{/);
  });
});
