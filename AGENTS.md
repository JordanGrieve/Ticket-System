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
