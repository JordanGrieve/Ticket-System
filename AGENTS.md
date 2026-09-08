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
- `tests/public-views-render.test.tsx` — home, pricing, contact, privacy, terms,
  no-access, 404, and the subscribe/unsubscribe pages a client's customer sees
- `tests/dashboard-views-render.test.tsx` — MailNav, /search, /settings/billing,
  /settings/contacts, /settings/forms, /settings/team, /settings/access-log and
  /subscribers/[id]

**Check the harnesses against the route tree, not against themselves.** The
five component harnesses covered the screens somebody had thought to build a
fixture for. Listing them beside `find app -name page.tsx` on 7 Sep 2026 found
seven signed-in routes with no coverage of any kind — and MailNav, the
navigation column on EVERY signed-in screen, which no test had ever rendered
because the other harnesses drop their view into a bare `.pb-shell.pbm` div
with no chrome around it. The first sweep of it found the light theme painting
the whole navigation at 1.05:1.

**The homepage IS renderable.** This file used to say it was not, because
`app/page.tsx` calls Clerk's `auth()` which pulls `server-only` from inside
node_modules where the vitest alias does not reach. The diagnosis was right and
the conclusion did not follow: `vi.mock("@clerk/nextjs/server", …)` replaces the
whole module, so the real one never loads and never imports `server-only`.
Nothing needs aliasing. The most-visited page in the product spent months as the
only one no automated check could see, on the strength of an untested "cannot".

`tests/audit-runner.html` drives all of them. Copy it to `public/_runner/` and
open `/_runner/index.html` — note the filename, since `public/` does not serve a
directory index and `/_runner/` falls through to the router and lands on the
sign-in page. Then `await __runAll(urls, 375)` runs every probe over every
surface at a chosen width. Each surface loads in an iframe sized to that width,
so media queries, reflow and `elementFromPoint` all resolve against it and one
page load covers 36 surfaces. **This is not the innerHTML trap** — each page
loads its own untouched document from its own URL; the runner only reads across
a same-origin boundary.

Do not call `__audit()` from a driven pane. It awaits `__ready()`, which awaits
`requestAnimationFrame`, and rAF does not fire *at all* in a hidden document —
not throttled, stopped. It cannot reach its success path and hangs past the
tool's timeout. The runner calls the probes individually and proves the document
had text and controls in it instead.

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
- **`mockResolvedValue` on a bare `vi.fn()` takes `any`.** Same blind spot as
  `as never`, reached without writing a cast at all — so a mocked query's
  fixture is unchecked unless it says what it is. On 7 Sep this let a
  `countTicketsPerForm` fixture be a bare `Map` when the real return is
  `{ byForm, unattributed }`; the page died on `undefined.get` at render rather
  than at typecheck. Put `satisfies` on every mocked return value, and where
  the type is not exported, derive it:
  `type T = Awaited<ReturnType<typeof theRealFunction>>`.
- **Fixtures invent impossible states as readily as wrong ones.** A contacts
  fixture with `name: null` crashed `initials()` on `null.trim()` and looked
  like a real defect on a page that shows customer names. It was not:
  `contacts.name` is `notNull()` and typed `string`, so no such row exists.
  Before fixing a crash a fixture found, check that the fixture could happen.

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
- **A probe that works around a defect will never report it.** `__textZoom`
  doubled the root font-size and then ALSO set every element's size inline to
  twice its computed px, with a comment explaining that px ignores the root.
  That was a true statement about the stylesheets and exactly the wrong response
  to it: the workaround made a product where NO text responded to the root
  produce a clean 200% reading. The whole product was in px — 374 declarations
  plus 19 inline — and a reader who set their browser font size to "Very large"
  got nothing at all. Everything is rem now, `__textZoom` reports what failed to
  grow instead of faking it, and `tests/type-scale.test.ts` fails CI on a px
  font-size. When a probe contains a workaround for a product problem, the
  workaround is the bug.
- **Set the threshold from the failure's signature, not from a round number.**
  The first version of that check asked for 1.5x growth and reported the
  homepage h1, which is `clamp(2.375rem, 6.4vw, 4rem)` and correctly stops at
  its viewport term — 1.44x, not a defect. Text that cannot be enlarged has an
  unmistakable signature: it comes back at exactly 1.0x. The bar is 1.1x, and
  the ratio is reported either way so a borderline case can be judged.
- **A guard is only as wide as its input.** The "no white ink on flat
  `--accent`" scan was added on 6 Sep after four rules were found. On 7 Sep a
  browser sweep found a fifth, on `/no-access`: 3.20:1 in forest, 3.01:1 in
  slate. The guard had not failed — it had never been able to see it, because it
  read `.css` and this was a React style object in a `.tsx`. It also scanned a
  hardcoded list of nine stylesheets when the repo has twenty, omitting every
  public marketing page. Both were how the same bug shipped twice. Discover the
  files; scan both languages; assert the discovery found something.
- **A surface that paints its own background must set its own ink.**
  `.pb-sidebar` set `background: var(--nav)` — near-black indigo in all six
  themes — and no `color`, so it inherited the page's `--text`, which DOES
  follow the theme. Five of the six themes are dark, so their `--text` is light
  and it read correctly by coincidence; the light theme rendered the entire
  navigation at 1.05:1. `--nav-fg` and `--nav-muted` exist now, and
  tests/contrast-tokens.test.ts measures them against `--nav` rather than
  against a page surface. Whenever a token pair is fixed while its partner
  flips per theme, the pairing has to be asserted somewhere.
- **A closed off-canvas drawer is not a reflow failure.** The mobile nav is
  `position: fixed` with `translateX(-300px)` and `data-open="false"`, so all
  fifty of its descendants sit outside the viewport and `__overflow` reported
  every one of them. The document's scrollWidth equalled the viewport: nothing
  required horizontal scrolling, which is what 1.4.10 is about. `offCanvasClosed`
  excludes them, and deliberately narrowly — the ancestor must be out of flow,
  ENTIRELY outside the viewport, and marked closed. It also fixed a phantom
  `__flexSentences` hit, because a Range's rect inside a translated subtree does
  not always carry the transform.
- **A harness page with no `?theme=` is whatever the PANE prefers.** The
  driven browser pane runs dark, so every "default theme" reading on 8 Sep
  2026 was the system-dark block, not light — an hour of token tuning went to
  the wrong palette before a card ground of `rgb(36,31,60)` gave it away. The
  light palette had not been measured at all. Always pass the theme by name,
  and sweep light and dark as two runs; "no theme" is not a theme.
- **An override on the element that carries `data-theme` loses to the palette
  block.** `.pba-root { --muted: … }` and `[data-theme="dark"] { --muted: … }`
  are equal specificity and the palette comes later, so the console's own
  values were silently ignored. Scope it `.pba-root[data-theme="dark"]`.
- **`__contrast("AAA")` and `__targets(44)` exist from 8 Sep 2026.** Same
  measurement, higher bar: 7:1 / 4.5:1 for 1.4.6 and 44px with no spacing
  exception for 2.5.5. Everything that could be tuned by token was; what is
  left at AAA is white on `--accent-grad` (4.52:1 on every primary button),
  which needs a darker brand accent and is Jordan's decision, plus adjacent
  14px chip crosses that cannot all be 44px without spacing, and inline links.
- **A heredoc `node -` script with a regex in it will lose its backslashes and
  throw — or worse, run.** It happened twice on 8 Sep while applying token
  values; the second time the error surfaced only because the anchor string was
  checked. The scripts in the scratchpad are files for this reason.
- **1.4.3 exempts inactive controls, and the probe must know it.** A disabled
  Save button at 0.5 opacity measures ~2.1:1 and is correct. `__contrast` marks
  those `exempt` rather than dropping them, on the same principle as `__ready`:
  an exemption applied silently cannot be told apart from a probe that stopped
  looking.
- **Composite alpha, and let the browser parse colour.** Contrast is measured
  through a 1x1 canvas so `oklch()` and `color-mix()` work, over a ground built
  by stacking every translucent layer. A regex-and-nearest-background version
  reported a working pill at 1.61:1 when it was 4.63:1.
