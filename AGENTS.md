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
