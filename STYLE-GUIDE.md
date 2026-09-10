# Postbox style guide

How a screen in Postbox is built, so the next page and the next feature come
out looking like the last one and pass the same checks. Started 9 Sep 2026
while QA-ing the inbox and thread on a phone; every rule here was measured on
the live site before it was written down.

This is the document to read before touching any `.css` file or adding a
route. AGENTS.md is the engineering rulebook (harnesses, probes, guards);
this is the design rulebook. When they disagree, AGENTS.md wins and this file
is wrong — fix it.

## 1. The bar

Postbox is held to **WCAG 2.2 AAA**, Jordan's call ("it has to comply with
AAA"). That is not a target for later; it is the acceptance test for every
change. The criteria that decide most of what follows:

| Criterion | What it means here |
| --- | --- |
| 1.4.6 Contrast (Enhanced) | Text 7:1 on its ground; large text (≥ 24px, or ≥ 18.66px bold) 4.5:1 |
| 1.4.11 Non-text contrast | Icons, focus rings, borders that carry meaning: 3:1 |
| 1.4.4 / 1.4.12 | Every font-size in `rem`; nothing breaks at 200% or with spacing overrides |
| 1.4.8 Visual presentation | Body text line-height 1.5, lines ≤ 80 characters, never justified |
| 1.4.10 Reflow | Nothing scrolls sideways at 320px except a strip that is MEANT to |
| 2.5.5 Target size (Enhanced) | Every control 44×44 CSS px, no spacing exception — inline links in a sentence are the only exemption |
| 2.4.7 / 2.4.9 | A visible focus ring on everything; every link's purpose readable from its name alone |
| 2.3.3 Animation from interactions | One blanket reduced-motion rule at the END of globals.css |

`tests/contrast-tokens.test.ts`, `tests/type-scale.test.ts`,
`tests/reduced-motion.test.ts` and `tests/focus-ring-coverage.test.ts` pin the
parts a stylesheet can be checked for. The browser probes in
`tests/audit-probes.js` (`__contrast("AAA")`, `__targets(44)`, `__links()`,
`__textBlocks()`, `__overflow()`, …) measure the rest on a rendered page.

## 2. Themes: light and dark

Two palettes, since 9 Sep 2026. Light is `:root` / `[data-theme="light"]`;
dark is `[data-theme="dark"]`. A signed-in workspace ALWAYS carries one of
the two on `<html>` (`components/ThemeApplier.tsx`, `lib/theme.ts`). Pages
with no workspace — marketing, `/contact`, subscribe/unsubscribe — carry
neither and follow `prefers-color-scheme` through the media block that
mirrors dark.

Rules:

- **Never write a colour in a component or a component stylesheet.** Read a
  token. The only literal hexes allowed are the theme swatches in
  `ThemePicker.tsx` (they must show a theme that is NOT applied) and the
  impersonation pill (it must look identical in every theme).
- **A surface that paints its own background sets its own ink.** `--nav` is
  dark in both themes, so it has `--nav-fg` / `--nav-muted` and never uses
  `--text`. Any new fixed-colour surface needs its own pair, and a test
  pairing them.
- **Retune against the ground the ink is painted on.** The chips on the
  thread header sit on `--surface-2`, not `--surface`, and were 6.9:1 until
  measured there. `__contrast` composites every translucent layer; trust it
  over the token sheet.
- **Set `data-theme` before first paint, never flip it at runtime** in a
  harness or a probe. The product only sets it once, on mount.

### Tokens you will actually use

| Token | Use |
| --- | --- |
| `--surface`, `--surface-2`, `--surface-3` | Card, page ground, inset ground (inputs, chips) |
| `--text`, `--text-2`, `--text-3`, `--text-4` | Ink, from headline to the palest AAA-passing label |
| `--muted`, `--muted-2` | Secondary text. Already AAA on `--surface-3`; do not lighten them |
| `--accent`, `--accent-grad` | The brand purple. White on either clears 7:1. Flat `--accent` under white text is guarded against; use the gradient for filled buttons |
| `--accent-text`, `--accent-chip`, `--accent-soft` | Purple ink and the pale grounds it sits on |
| `--tag-a/b/c-fg` + `-bg` | Label and source chip pairs (green / purple / amber) |
| `--ok-fg`, `--warn-fg`, `--pdf-fg` | Status inks |
| `--border`, `--border-soft`, `--border-strong` | Lines, palest to strongest |
| `--focus-ring` | The ONLY colour a focus ring may be. Chosen to clear 3:1 on `--surface`, `--surface-3` and `--nav` at once |
| `--nav`, `--nav-fg`, `--nav-muted`, `--nav-active-bg/fg`, `--nav-badge-*` | The navigation column, both themes |
| `--shadow`, `--shadow-2` | Elevation |
| `--tap-min` | 44px. Read it with a fallback: `min-height: var(--tap-min, 44px)` |

## 3. Type

Plus Jakarta Sans for everything; Spline Sans Mono for code and ids. Sizes
in `rem` only — `tests/type-scale.test.ts` fails CI on a `px` font-size.

| Role | Size | Weight |
| --- | --- | --- |
| Page title (`h1`) | 1.25rem | 800 |
| Section heading | 0.84375rem | 800 |
| Body, message text | 0.84375rem, line-height 1.55 | 500 |
| Card title, nav row | 0.84375rem | 700 |
| Meta, timestamps | 0.75rem | 600–700 |
| Chips and badges | 0.75rem | 700 |
| Counts in pills | 0.6875rem | 800 |

- Body line-height **1.5**. Headings may be tighter.
- Reading width **54ch**. In this face `ch` is 0.73em, so 54ch ≈ 80 average
  characters; the `70ch` that reads as "70 characters" is 100. Applied to
  `.pbm-bubble`, `.pbm-transcript-note`, `.pbm-thread-email`.
- Never `text-align: justify`. Never `letter-spacing` below −0.5px on body.

## 4. Targets and spacing

**44 × 44 CSS px for every control, at every width.** There is no "mouse
users get 24" — 2.5.5 does not distinguish pointers, and the desktop thread
header had six 24px controls when this was decided.

- **Grow the hit area, not the drawing,** when a 44px box would wreck the
  layout: `position: relative` on the control and an invisible
  `::before`/`::after` with negative `inset`. A 14–16px cross gets
  `inset: -14px` (a SQUARE — a 44px circle's corners fall 8px short of the
  square the probe tests). A 32px chip gets `inset: -6px 0`.
- **Then space the rows so the hit areas do not overlap.** 32px chips with
  6px of hit area each side need a **12px** row gap (32 + 12 = 44). This is
  the only reason `.pbm-subject-chips` has `gap: 12px 8px`.
- **Inline links in a sentence** are the one exemption. Everything that
  stands on its own — a "Do it" link, a "Manage" button, a chip's cross —
  is a target.
- **A control nobody can reach is not a target**: a disabled placeholder in
  the phone header is hidden, not shrunk.
- Spacing scale: 4 / 6 / 8 / 12 / 16 / 18 / 24. Page padding 18px on a
  phone, 20px on desktop. Radii: 10 (chips), 12 (buttons), 14 (nav rows,
  folder chips), 16 (search), 20 (cards), 26–28 (sheets).

## 5. The pieces

### Chips (thread header)

One row, one size. Message count, status, source, every label and "+ Label"
are all **32px tall, 0.75rem/700, radius 10, padding 0 12px**. Static chips
are `span`s and need no target; the status button, "+ Label" and each
label's cross carry their 44px hit areas as above. The label picker renders
`display: contents` into the row so its chips are cells of it — do not give
it a row of its own again.

### Folder strip (phone, under the search box)

Every folder as a 44px chip in a horizontally scrolling `nav`. It **bleeds
to both screen edges** (`margin: 0 -18px; padding: 2px 18px 6px`) so it reads
as a strip that continues, not a row that ends. `touch-action: pan-x` so a
sideways drag here is never a swipe on the card below. Its class is
`.pbm-folder-strip` — NOT `.pbm-folders`, which is the drawer's folder
group; sharing the name laid the drawer out sideways and emptied the burger.

### Navigation

Desktop: a 262px column. Phone: the burger opens an off-canvas drawer with
**everything** in it — the working folders, every label, Newsletters,
Subscribers, Settings, the account menu. Labeled, Snoozed, Archived and
Trash sit behind a More/Less row (the active one is always shown). No bottom
tab bar; the burger and the folder strip are the whole navigation. Rows are
44px; a label's colour dot is 12px (`.pbm-label-swatch`) and only the
picker's swatches (`--pick`) are 44px targets.

### The contact sheet (phone)

A bottom sheet from 15vh. Three ways to close, all through one `onClose`:
the 44px cross (full `--text` ink, radius 12), Escape, and **dragging down**.
Dragging works from the grip (pointer events, `touch-action: none`) AND
from the body — when the body is scrolled to its top and the finger moves
down, the sheet moves; otherwise the body scrolls. The rule is
`decideSheetTouch` in `lib/sheet-drag.ts`; the wiring is raw non-passive
touch listeners in `ContactRail.tsx`, because `touch-action` cannot express
a conditional claim. Past 110px of travel, release closes; a system cancel
never closes.

### Swipe rows (inbox, Open folder)

Archive on the right, trash on the left, 72px actions, 160px reveal.
`lib/swipe.ts` holds the maths. The front face is `touch-action: pan-y` so a
vertical scroll is never captured.

### Buttons

**The standard button is `.stg-button`** (app/settings.css), the look of the
Forms page's Create: `--accent-grad`, white text, 44px, radius 10, 0.8125rem/700.
`.stg-button--wide` is the full-width 48px form for a form's one committing
action (Send invite). New screens use these classes. Quiet: `--surface-3`
ground, `--text` ink. Destructive: `--pdf-fg` ink on `--pdf-bg`. Never white
text on flat `--accent`.

### Focus

`outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px`
on `:focus-visible`, everywhere. Never remove an outline without replacing
it. Never use `--accent` as the ring: it was deepened for text and dropped
under 3:1 on the nav.

### Motion

Transitions 160ms ease; sheet and drawer 220ms. Do not write your own
`prefers-reduced-motion` block — the blanket rule at the end of
`globals.css` covers every animation and transition, and
`tests/reduced-motion.test.ts` pins that it is last.

## 6. Adding a page

1. Every route gets a `loading.tsx` skeleton (`tests/skeletons.test.tsx`
   requires it). Skeletons use the real classes so they lay out like the page.
2. Add it to the matching render harness (`tests/*-views-render.test.tsx`) so
   it can be rendered with no login and swept by the probes.
3. Run it through the runner at 375 and 1280, in **both** themes, passing
   `?theme=` explicitly — a page with no theme renders in whatever the pane
   prefers, which on 8 Sep 2026 cost an hour of tuning the wrong palette.
4. `__selftest()` before believing a clean result. A skeleton passes every
   check; `__ready()` says what it waited for.
5. Then look at it on the LIVE site through the Chrome extension, at phone
   width, and touch the things a thumb would touch. The harness cannot run a
   gesture; the sheet drag was "working" in it for a week.

## 7. Things that look like rules and are not

- `--tap-min` was 24px "because a mail client is dense". It is 44.
- Six themes was "the design". It is two.
- "Three folders then More" hid eight. Only the four look-up folders hide.
- A 44px circle for a cross's hit area. It is a square.
- `70ch` for 80 characters. It is 54ch in this face.

### Theme toggle (Settings → General)

Two 44px chips in a row, a sun and a moon with the name beside each, built
on real radios. Not cards, not swatches: with two choices a picture of each
is furniture.

### Explanatory boxes

Do not add a paragraph explaining a rule or a consequence inside a settings
screen. Jordan's call, 9 Sep 2026: "these should be known, we will have a
FAQ thing later." Errors and results of an action (`stg-identity-warn` as
`role="alert"`, `stg-notice` as `role="status"`) stay; standing explanations
go.
