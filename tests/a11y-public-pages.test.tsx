import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Pricing from "../app/pricing/page";
import Privacy from "../app/(legal)/privacy/page";
import Terms from "../app/(legal)/terms/page";
import Contact from "../app/contact/page";
import LegalLayout from "../app/(legal)/layout";
import { HONEYPOT_FIELDS } from "../lib/subscribe";

/**
 * Structural accessibility of the pages a stranger can reach.
 *
 * ── WHY THESE CHECKS AND NOT A SCORE ──
 * Every assertion here is something a screen-reader user or a keyboard user
 * loses outright when it breaks: a page with no h1 has no title to jump to, a
 * link with no accessible name is announced as "link", an input with no label
 * is announced as "edit text, blank". None of them are style opinions and none
 * of them need a human to adjudicate, which is what makes them worth pinning
 * rather than re-auditing by hand.
 *
 * ── WHAT THIS DOES NOT COVER, SAID OUT LOUD ──
 *  1. THE HOMEPAGE. app/page.tsx calls Clerk's auth(), which pulls `server-only`
 *     from inside node_modules where this project's vitest alias does not
 *     reach, so it cannot be rendered here. Stubbing Clerk would make this file
 *     more scaffolding than assertion. It was audited in a browser on 31 Aug
 *     and came back clean, and it shares MarketingNav with /pricing — which IS
 *     covered — so a nav regression still shows up here. That is a smaller
 *     claim than "the homepage is guarded", and it is the true one.
 *  2. TAB ORDER. Synthetic key events do not drive the browser's own focus
 *     traversal, so the sequence elements receive focus in is unverified. The
 *     focus ring's visibility is covered by tests/contrast-tokens.test.ts.
 *  3. Anything needing layout: overlap, reflow at zoom, tap target sizes.
 *
 * ── WHY RENDERING RATHER THAN READING THE SOURCE ──
 * An earlier attempt at a source-pattern check for a different problem flagged
 * nine places of which eight were fine. Structure is not a text pattern. These
 * assertions run against the markup the component actually emits, which is the
 * only place "this input has no label" is a fact rather than a guess.
 *
 * Whitespace is deliberately NOT asserted here: vitest transforms JSX with
 * esbuild and Next ships SWC, and the two disagree about a space next to a
 * closing inline tag. Structure is identical under both; spacing is not.
 */

type Page = () => React.JSX.Element;

/*
  Some pages carry their own <main>; the two legal ones get it from the route
  group layout. Rendering a page alone would report /privacy as having no main
  landmark, which is false of the page that actually ships — so a page that
  relies on a layout is rendered INSIDE that layout here.

  Caught by the landmark assertion failing on exactly those two while the
  browser audit had reported main: 1 for both. The disagreement was the test
  measuring something narrower than what a visitor loads.
*/
const inLegalLayout = (Page: Page): (() => React.JSX.Element) =>
  function Wrapped() {
    return <LegalLayout>{<Page />}</LegalLayout>;
  };

const PAGES: [string, Page][] = [
  ["/pricing", Pricing as Page],
  ["/privacy", inLegalLayout(Privacy as Page)],
  ["/terms", inLegalLayout(Terms as Page)],
  ["/contact", Contact as Page],
];

/**
 * Index ranges of the markup that assistive technology never sees.
 *
 * aria-hidden applies to the whole SUBTREE, not just the element carrying it,
 * and a regex over tags cannot see ancestors. Without this the label check
 * flagged the two honeypot inputs on /contact — which are deliberately
 * unlabelled and already inside <div aria-hidden="true">, so they are not in
 * the accessibility tree at all and a label on them would be the bug.
 *
 * I nearly "fixed" the page for it. Worth stating: the test was wrong, the
 * markup was right, and the difference was an ancestor the check could not see.
 *
 * Depth-counted per tag name. renderToStaticMarkup emits well-formed markup, so
 * matching the opening tag to its close is reliable here in a way it would not
 * be over hand-written HTML.
 */
function ariaHiddenRanges(html: string): [number, number][] {
  const ranges: [number, number][] = [];
  const open = /<([a-z]+)\b[^>]*aria-hidden\s*=\s*"true"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const tag = m[1]!;
    if (m[0].endsWith("/>")) { ranges.push([m.index, m.index + m[0].length]); continue; }
    let depth = 1;
    const scan = new RegExp(`<\\/?${tag}\\b[^>]*>`, "g");
    scan.lastIndex = m.index + m[0].length;
    let t: RegExpExecArray | null;
    while (depth > 0 && (t = scan.exec(html))) {
      depth += t[0].startsWith(`</`) ? -1 : 1;
    }
    ranges.push([m.index, scan.lastIndex || html.length]);
  }
  return ranges;
}

/** Is this offset inside something aria-hidden? */
function hidden(ranges: [number, number][], at: number): boolean {
  return ranges.some(([a, b]) => at >= a && at < b);
}

/** Elements a screen reader announces by name, and how the name is derived. */
function accessibleNames(html: string, tag: string): { count: number; unnamed: number } {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  let count = 0;
  let unnamed = 0;
  while ((m = re.exec(html))) {
    count++;
    const attrs = m[1] ?? "";
    const inner = (m[2] ?? "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim();
    const labelled =
      /aria-label\s*=\s*"[^"]+"/.test(attrs) ||
      /aria-labelledby\s*=\s*"[^"]+"/.test(attrs) ||
      /title\s*=\s*"[^"]+"/.test(attrs);
    if (!inner && !labelled) unnamed++;
  }
  return { count, unnamed };
}

describe.each(PAGES)("%s", (name, Page) => {
  const html = renderToStaticMarkup(<Page />);

  it("rendered something to assert about", () => {
    /*
      The canary. Every assertion below is a "no bad things found" check, and
      all of them pass vacuously against an empty string — which is exactly how
      a suite reports green while measuring nothing.
    */
    expect(html.length).toBeGreaterThan(500);
  });

  it("has exactly one h1", () => {
    // Zero leaves a screen reader with no page title to jump to; more than one
    // makes "the heading" ambiguous.
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
  });

  it("does not skip a heading level", () => {
    // h2 -> h4 reads as a missing section to anyone navigating by headings.
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    const jumps: string[] = [];
    let prev = 0;
    for (const l of levels) {
      if (prev && l > prev + 1) jumps.push(`h${prev} -> h${l}`);
      prev = l;
    }
    expect(jumps, `${name} skips heading levels`).toEqual([]);
  });

  it("has no empty headings", () => {
    const empties = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].filter(
      (m) => !(m[1] ?? "").replace(/<[^>]*>/g, "").trim(),
    );
    expect(empties.length).toBe(0);
  });

  it("gives every image an alt attribute", () => {
    // Absent alt is announced as the filename. alt="" is a valid answer meaning
    // decorative, so this checks the attribute EXISTS, not that it is non-empty.
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.filter((i) => !/\balt\s*=/.test(i))).toEqual([]);
  });

  it("gives every link an accessible name", () => {
    expect(accessibleNames(html, "a").unnamed, `${name} has links announced as just "link"`).toBe(0);
  });

  it("gives every button an accessible name", () => {
    expect(accessibleNames(html, "button").unnamed).toBe(0);
  });

  it("labels every form control", () => {
    /*
      An unlabelled input is announced as "edit text, blank" — the user is told
      there is a box and nothing about what belongs in it. A wrapping <label>,
      a label[for], aria-label or aria-labelledby all count.
    */
    const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)];
    const labelFors = new Set(
      [...html.matchAll(/<label\b[^>]*\bfor\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    const hiddenRanges = ariaHiddenRanges(html);
    const unlabelled = controls.filter((m) => {
      const attrs = m[0];
      // Not in the accessibility tree, so there is nothing to announce and a
      // label would be wrong rather than missing.
      if (hidden(hiddenRanges, m.index)) return false;
      if (/type\s*=\s*"hidden"/.test(attrs)) return false;
      if (/aria-label\s*=\s*"[^"]+"/.test(attrs)) return false;
      if (/aria-labelledby\s*=\s*"[^"]+"/.test(attrs)) return false;
      const id = /\bid\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
      if (id && labelFors.has(id)) return false;
      // A wrapping <label> — the idiom this codebase uses on /contact.
      const before = html.slice(Math.max(0, m.index - 400), m.index);
      return !(before.lastIndexOf("<label") > before.lastIndexOf("</label>"));
    });
    expect(unlabelled.map((m) => m[0].slice(0, 60))).toEqual([]);
  });

  it("uses no positive tabindex", () => {
    // A positive value pulls an element out of document order and hijacks the
    // whole sequence for everyone after it.
    const positives = [...html.matchAll(/tabindex\s*=\s*"(\d+)"/g)].filter(
      (m) => Number(m[1]) > 0,
    );
    expect(positives.length).toBe(0);
  });

  it("has no duplicate ids", () => {
    // Duplicates break label[for] and aria-labelledby silently — the reference
    // resolves to whichever came first.
    const ids = [...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it("has exactly one main landmark", () => {
    // "Skip to main content" needs somewhere to skip TO.
    expect((html.match(/<main[\s>]/g) ?? []).length).toBe(1);
  });
});

/**
 * /contact WITH its form, which is the only reason the label checks exist.
 *
 * ── THE VACUOUS PASS THIS CLOSES ──
 * Without POSTBOX_CONTACT_KEY the contact page renders the "this form isn't
 * connected yet" notice and NO inputs at all — so "labels every form control"
 * passed on it while measuring nothing. That is the same shape as the canary
 * above: a "nothing bad found" assertion over an empty set is indistinguishable
 * from a passing one, and it was covering the only form on the public site.
 *
 * lib/config.ts reads the key once at module load, so the env has to be set
 * before the import — hence resetModules and a dynamic import rather than the
 * static ones above.
 */
describe("/contact with the key configured", () => {
  let html = "";

  beforeAll(async () => {
    vi.resetModules();
    process.env.POSTBOX_CONTACT_KEY = "cli_testkeyfortestsonly";
    const mod = await import("../app/contact/page");
    html = renderToStaticMarkup(React.createElement(mod.default as () => React.JSX.Element));
  });

  afterAll(() => {
    delete process.env.POSTBOX_CONTACT_KEY;
    vi.resetModules();
  });

  it("actually renders the form", () => {
    // The canary for this block specifically. If the key stops reaching the
    // page, every assertion below silently goes back to proving nothing.
    expect(html).toContain("<form");
    expect((html.match(/<input/g) ?? []).length).toBeGreaterThan(0);
  });

  it("labels every visible control", () => {
    const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)];
    const labelFors = new Set(
      [...html.matchAll(/<label\b[^>]*\bfor\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    const hiddenRanges = ariaHiddenRanges(html);
    const unlabelled = controls.filter((m) => {
      const attrs = m[0];
      // Not in the accessibility tree, so there is nothing to announce and a
      // label would be wrong rather than missing.
      if (hidden(hiddenRanges, m.index)) return false;
      if (/type\s*=\s*"hidden"/.test(attrs)) return false;
      if (/aria-label\s*=\s*"[^"]+"/.test(attrs)) return false;
      if (/aria-labelledby\s*=\s*"[^"]+"/.test(attrs)) return false;
      const id = /\bid\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
      if (id && labelFors.has(id)) return false;
      const before = html.slice(Math.max(0, m.index - 400), m.index);
      return !(before.lastIndexOf("<label") > before.lastIndexOf("</label>"));
    });
    expect(unlabelled.map((m) => m[0].slice(0, 70))).toEqual([]);
  });

  it("keeps the honeypot out of the accessibility tree", () => {
    /*
      The spam trap must be hidden from assistive technology, not only from
      sighted users. A field hidden with CSS alone is still announced, and a
      screen-reader user who fills it in is silently discarded as a bot — the
      one accessibility failure here that costs somebody their enquiry.

      Asserted against the aria-hidden SUBTREE rather than the input's own
      attributes: the page wraps both traps in one hidden container, which is
      the correct way to do it and the way a per-element check misreads.
    */
    const ranges = ariaHiddenRanges(html);
    const traps = [...html.matchAll(/<input\b[^>]*>/g)].filter((m) =>
      HONEYPOT_FIELDS.some((f) => new RegExp(`name="${f}"`).test(m[0])),
    );
    expect(traps.length, "no honeypot field found to check").toBe(HONEYPOT_FIELDS.length);
    for (const t of traps) {
      expect(
        hidden(ranges, t.index),
        `honeypot is exposed to assistive technology: ${t[0].slice(0, 90)}`,
      ).toBe(true);
    }
  });
});
