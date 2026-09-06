<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Comments that close the thing they live in

This repo comments heavily, which makes one failure mode common enough to be
worth naming: a character inside a comment that terminates its container.

It has happened twice, and both times the breakage reached a shared tree and
another agent hit it first.

1. A cron expression written inside a block comment. The star-slash in the
   "every 5 minutes" form ended the comment, and the rest of the schedule
   became code.
2. A backtick inside a tagged SQL template. It ended the string, and the SQL
   after it became code.

**No linter can catch either.** Both are parse errors, so the file does not
parse for ESLint any more than it does for the compiler. The only thing that
catches them is a typecheck — which is why `npm run typecheck` is the FIRST
step in CI, ahead of lint, tests and the build.

So the rules are:

- **Never write a raw cron expression in a block comment.** Say "every five
  minutes" in prose, or reference the constant — `SWEEP_CADENCE` in
  `lib/campaign-schedule.ts` derives the English from the schedule, so the
  comment cannot drift from the workflow file either.
- **Never write a backtick inside a tagged template literal.** Name the column
  in plain words rather than quoting it.
- **Run `npm run typecheck` AFTER your final edit, not before it.** The first
  incident happened because verification ran before the change that broke
  things. A green check from three edits ago proves nothing.

# Backslashes do not survive being typed through a shell

A sibling of the above, and it happened three times in one session on
30 August 2026.

Writing code by piping a string through `bash -c`, `node -e`, or a heredoc puts
it through two or three levels of unescaping before it reaches the file. What
you typed is not what lands:

1. `"\n"` inside a `node -e` string became a REAL NEWLINE in the middle of a
   regex literal — `.replace(/\n/g, …)` arrived as `.replace(/` then a line
   break. A parse error, so typecheck caught it.
2. The same thing in `CSS.indexOf("\n}")` — an unterminated string. Also caught.
3. `/rgba?\(\s*([\d.]+)…/` lost EVERY backslash and arrived as
   `/rgba?(s*([d.]+)…/`. **This one still parsed.** It was a valid regex that
   simply never matched, inside a test whose failure branch was
   `if (!ground) return` — so the whole check reported green while measuring
   nothing at all, and passed just as happily on the values it was written to
   reject.

The third is the one that matters. The first two failed loudly the moment
`tsc` ran. The third produced a passing test that proved nothing, and was only
caught by deliberately reverting the fix to see whether the test noticed.

So:

- **Use the file-editing tools for any content containing a backslash.** Not
  `sed`, not `node -e`, not a heredoc. This includes every regex, every `\n`,
  and every escaped quote.
- **A test that cannot fail is worse than no test.** After writing one, break
  the thing it guards and watch it go red. Every guard added that day was
  checked this way, which is the only reason (3) was found.
- **Never write `if (!x) return` in a test.** A value that cannot be read is a
  broken test, not an absent problem — assert on it and let it fail with the
  input it could not parse.

# Every screen can be rendered without a login

Almost every screen in this product is behind Clerk, and most also need a
workspace with data in it. That is why layout bugs survived here for months:
nobody could look. Five test files fix that, and they are the first thing to
reach for before opening a browser.

- `tests/admin-sections-render.test.tsx` — the six console panes
- `tests/mail-views-render.test.tsx` — inbox, thread, rail, labels, onboarding
- `tests/settings-views-render.test.tsx` — themes, sender, brand, auto-reply, install
- `tests/newsletter-views-render.test.tsx` — the composer
- `tests/subscribers-views-render.test.tsx` — the subscriber list

In CI they assert the views render at all, which nothing did before. Given an
output directory they also write a standalone page per view, dressed in the
real stylesheets and carrying the probes from `tests/audit-probes.js`:

```
SETTINGS_HARNESS_OUT=$PWD/public/_sh npx vitest run tests/settings-views-render
```

Then open `/_sh/themes.html?theme=slate` on the dev server and call
`__audit()`, or any probe on its own: `__selftest()`, `__overflow()` (1.4.10),
`__contrast()` (1.4.3), `__targets()` (2.5.8), `__flexSentences()`,
`__names()` (1.1.1, 2.4.4, 4.1.2), `__headings()` (1.3.1), `__structure()`
(3.1.1, 2.4.2, duplicate ids, focusables inside aria-hidden, positive
tabindex), `__textSpacing()` (1.4.12), `__textZoom()` (1.4.4) and
`__focusVisible()` (2.4.7). The `public/_*` directories are gitignored; delete them
when you are done.

**A prop-driven component is not required.** `/subscribers` is an async server
component that fetches its own data, and `await SubscribersPage({ searchParams })`
returns the tree — only the query module and `lib/viewer` are stood in for, and
its own validation still runs. Do not refactor working code to make it
renderable until you have tried awaiting it.

## Never cast a fixture

`as never` and `as unknown as T` switch off the only check that a fixture
matches the thing it stands for. On 6 Sep 2026 taking them off the five render
harnesses turned up TWELVE wrong fixtures that no test and no audit had
noticed — invented fields (`authorEmail` for `authorLabel`, `ticketsInWindow`
for `ticketsSinceTrialStart`, `stripeStatus` for `subscriptionStatus`),
invented enum members (`double_opt_in`, when `ConsentMethod` is `signup_form |
checkout | api | import | manual`), and missing ones (`chainPrevHash` and
`chainHash`, on the access log whose whole subject is that hash chain).

They fail in both directions, which is the part worth remembering. The
onboarding fixture rendered a checklist with NO TEXT, so an accessibility
sweep over it found nothing and reported clean. The shared-link fixture
rendered one line instead of two, so the same sweep reported a WCAG
target-size failure that did not exist.

- **`satisfies T`** for a complete fixture: the literal keeps its narrow types
  and tsc still rejects a wrong or missing field.
- **`satisfies Partial<T> as T`** when a test deliberately supplies only the
  fields the code reads. Partiality is fine; an unchecked field NAME is not.
- The one file that had no casts was also the only one with no wrong fixtures.

## The rules these harnesses were built on

- **A skeleton will pass every check you have.** This is the worst one, because
  it reports success. Every route has a `loading.tsx`, React does not commit
  the swap while the document is hidden, and a browser pane driven by tooling
  is ALWAYS hidden — so probes measure placeholder bars, which have no text to
  fail a contrast check and no controls to fail a target check. A full sweep of
  the public pages came back perfectly clean this way. Skeletons are excluded
  from every probe now (`inSkeleton`), and `__ready()` reports what it waited
  for, so "could not measure" and "clean" cannot look the same. If you write a
  new probe, exclude them.
- **Do not poll in a hidden pane.** Timers are throttled hard, so a
  `setTimeout` loop that should take five seconds can outlive the tool's
  timeout. Harness pages are static and need no wait at all; call the probes
  directly.
- **`:focus` does not match when the document lacks focus**, which it always
  does here — `el.focus()` sets `activeElement` and nothing else changes. A
  probe that compared styles before and after reported fourteen failures on a
  page whose focus styles were fine. `__focusVisible()` refuses to answer
  instead, and the ring's coverage is guarded from the stylesheet in
  `tests/focus-ring-coverage.test.ts`.
- **Transparent text is not always invisible text.** `background-clip: text`
  with a gradient computes `color` to `rgba(0,0,0,0)`, which reads as 1:1
  against anything. The hero headline was reported that way. Measure the
  gradient stops.
- **Never inject markup into a page you are measuring.** Replacing
  `document.body.innerHTML` to loop over views reported inbox card names at
  1.12:1 — invisible text nobody had noticed, because it was not real.
  Navigate to each page instead. This has caused a false reading twice.
- **Set the theme before the first paint, never switch it at runtime.**
  Flipping `data-theme` on a live page had `.pbm-card` insisting on the dark
  `--surface` while its own computed `--surface` was `#ffffff`, which CSS
  cannot do. The harness pages take `?theme=` and set it in `<head>`, which is
  what `ThemeApplier` does in the product.
- **`__selftest()` before believing a clean result.** It injects a deliberately
  broken element for each probe and confirms each one still fires. It has
  caught three probes that were structurally incapable of reporting anything:
  an overflow check that treated `overflow: hidden` as safe, a flex check that
  measured `el.children` when the overflowing items are anonymous, and a
  fixed-width canary that fitted inside a desktop window.
- **When the browser disagrees with the source, suspect the bundle.** A stale
  `.next` chunk served an old palette across a full dev-server restart, and a
  rebuild loop that silently did nothing served an old `audit.js`. Fetch the
  file the page actually loaded and grep its text; `rm -rf .next` if it
  disagrees with disk.
- **Measure what the pointer hits, not the box.** Target size uses
  `elementFromPoint`, because the fix for a 14px icon is a pseudo-element that
  grows its hit area, and a control's real target is its `<label>` when it has
  one. Both were reported as failures by an earlier rect-based version.
- **Composite alpha, and let the browser parse colour.** Contrast is measured
  through a 1x1 canvas so `oklch()` and `color-mix()` work, over a ground built
  by stacking every translucent layer. A regex-and-nearest-background version
  reported a working pill at 1.61:1 when it was 4.63:1.
