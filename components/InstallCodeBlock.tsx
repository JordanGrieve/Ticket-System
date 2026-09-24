"use client";

import { useEffect, useRef, useState } from "react";
import CopyButton from "./CopyButton";
import type { Token } from "../lib/highlight";

/**
 * A snippet, shown short until somebody asks for the rest.
 *
 * The interactive half of the Install page's code blocks. InstallView is a
 * server component and does the colouring there — lib/highlight.ts never
 * reaches the browser — so this receives finished tokens and owns only the
 * Show more toggle and the Copy button.
 *
 * ── WHY ──
 * Both install sections lead with an AI prompt now, and a prompt is seventy
 * lines of instructions written for a machine. Rendered in full it is the whole
 * screen: the steps around it, the newsletter section below it and the key
 * rotation at the bottom all get pushed off, and a client scrolls past a wall
 * of text they were never meant to read to reach the thing they were looking
 * for. Jordan, 14 Sep 2026 — "they don't need to be the full size, just do it a
 * third of the size unless they hit show more".
 *
 * ── THE TOGGLE ONLY APPEARS WHEN IT IS EARNED ──
 * Measured, not assumed. The contact section shows a six-line form in its
 * no-code mode and a seventy-line prompt in the other, through this same
 * component; a "Show more" under six lines that are already all visible is a
 * control that lies about there being something behind it. So the height is
 * compared against the content after layout, and the button is rendered only
 * if the thing genuinely overflows.
 *
 * ── COPY TAKES THE WHOLE THING ──
 * The copy button reads `code`, not the DOM, so a collapsed block still copies
 * every line. Worth stating because the obvious implementation — read the
 * rendered text — would silently hand somebody a third of a prompt, and it
 * would look like it worked.
 */
export default function InstallCodeBlock({
  code,
  tokens,
  name,
  collapsible,
}: {
  code: string;
  /** `highlight(code, language)`, computed on the server. */
  tokens: Token[];
  /**
   * What this block holds, for the controls' accessible names — e.g. "the
   * contact form prompt".
   *
   * The page carries two of these, so without it there were two buttons named
   * "Copy snippet" and two named "Show more". Reads into a sentence: "Copy
   * snippet — the newsletter prompt", "Show more of the newsletter prompt".
   */
  name: string;
  /** Whether this block may be clipped. See InstallView's `Code`. */
  collapsible: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  /*
    Starts TRUE, which is the whole trick.

    The cap lives in the stylesheet, on `.is-clipped`. So a block that has not
    been clipped yet has no cap, its scrollHeight EQUALS its clientHeight, and
    "does this overflow?" is always no — the class can never be applied, and the
    measurement can never see the thing it exists to measure. Starting false
    shipped a page where every prompt stood at full height and no Show more
    appeared at all; the suite stayed green because the test stubbed the two
    heights to differ unconditionally, which is a state no browser produces.

    Clipped first, then measured: while the class is on, scrollHeight and
    clientHeight differ for real, so a SHORT snippet reports "fits" and this
    flips to false. It also means the long prompt never flashes at full height
    before collapsing.
  */
  const [overflows, setOverflows] = useState(true);
  const clipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = clipRef.current;
    /*
      Return without touching state. Setting `overflows` to false here would be
      a setState inside an effect (react-hooks/set-state-in-effect, and the rule
      is right — it is a value, not a side effect), so a stale `true` from a
      previous render is simply never READ: `clipped` below is gated on
      `collapsible` as well.
    */
    if (!collapsible || !el) return;
    // Compared while collapsed; expanding removes the cap, so measuring then
    // would always report "fits" and the button would vanish on first press.
    const check = () => {
      if (expanded) return;
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    // Re-measured on resize: the same prompt wraps differently at phone width,
    // and a block that overflows on a laptop may not on a wide screen.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [code, expanded, collapsible]);

  /* Derived, so a stale measurement from a collapsible block cannot leak into
     one that opted out. */
  const clipped = collapsible && overflows;

  return (
    <div className="sti-code">
      {/*
        Both controls in one row at the top right, the opener to the LEFT of
        Copy.

        It was a text button under the block, which put it at the bottom of a
        300px box — below the fold on a phone, and far from the only other
        control on the panel. Jordan, 14 Sep 2026: "add a button next to copy
        snippet on the left that says show more code."
      */}
      <div className="sti-code-copy">
        {clipped && (
          <button
            type="button"
            className="sti-code-more"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Show less" : "Show more"} code — ${name}`}
          >
            {expanded ? "Show less code" : "Show more code"}
          </button>
        )}
        <CopyButton
          value={code}
          label="Copy snippet"
          ariaLabel={`Copy snippet — ${name}`}
          compact
        />
      </div>
      {/*
        The clip is a wrapper, not the <pre> itself.

        The <pre> scrolls horizontally, and an absolutely positioned fade inside
        a horizontally scrolling box slides away sideways with the content. The
        wrapper does the vertical clipping and carries the fade; the <pre> keeps
        its own overflow-x and nothing moves.
      */}
      <div
        ref={clipRef}
        className={`sti-code-clip${!expanded && clipped ? " is-clipped" : ""}`}
      >
        <pre>
          {/*
            One span per run. The tokeniser is asserted to round-trip, so the
            text rendered here is the text the copy button sends — a client can
            trust that what they are looking at is what they are handing over.
          */}
          <code>
            {tokens.map((token, i) => (
              <span key={i} className={`hl-${token.kind}`}>
                {token.text}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
