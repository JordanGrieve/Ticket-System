# The development database

**Until 23 August 2026 there wasn't one.** `.env.local` held the production
connection string, so `next dev`, every `tsx db/*.ts` script and every ad-hoc
diagnostic ran against a live client's customer records — real names, real
email addresses, real support conversations. Nothing sat between a mistyped
`WHERE` clause and a real business's data.

It never went wrong, which is not the same as being safe.

`db/guard.ts` now refuses to connect from a laptop unless the database is
declared. This page is how you declare one.

---

## Set it up once (about two minutes)

Neon branches are copy-on-write clones of your main database: instant, no data
copy, included on the free plan. You get the real schema and the real shape of
the data without touching the real rows.

1. **Neon console → your project → Branches → New branch.**
   - Branch from: `main` (or `production`, whatever yours is called)
   - Name: `dev`
   - Include data: yes — this is what makes it useful
2. Open the new branch → **Connection string** → copy it.
3. In `.env.local`, replace the connection string and add the declaration:

   ```
   DATABASE_URL="<the dev branch connection string>"
   DATABASE_ENV=development
   ```

4. Bring the schema up to date and put some data in it:

   ```bash
   npm run db:migrate
   npm run db:seed-dev
   ```

That's it. `npm run dev` and every script now work exactly as before, against a
database you are free to break.

---

## When you genuinely need production

Reading a real row to diagnose something is legitimate. Do it per command, so
the decision is visible in your shell history rather than sitting permanently
in a file:

```bash
ALLOW_PRODUCTION_DB=1 npx tsx db/some-script.ts
```

Only `1` works — not `true`, not `yes`. It has to be typed deliberately.

**Never put `ALLOW_PRODUCTION_DB` in `.env.local`.** That converts a decision
into a default and puts you back exactly where this started.

---

## What is and isn't guarded

| Path | Guarded | How |
|---|---|---|
| `next dev`, any app query | ✅ | `db/index.ts` — the single chokepoint every query passes through |
| `npm run db:seed`, `db:seed-dev`, `db:bootstrap` | ✅ | They import `db/index.ts` |
| `npm run db:migrate`, `db:push`, `db:studio` | ✅ | `drizzle.config.ts` repeats the check — drizzle-kit doesn't import `db/index.ts` and connects on its own |
| Production on Vercel | ✅ allowed | `VERCEL=1` or `VERCEL_ENV` is set; production is the correct database there |
| `psql`, the Neon SQL editor, a GUI client | ❌ | Nothing in this repo can guard a tool that doesn't run this code |

`db:push` is the sharp one. It diffs the schema and applies the difference
directly, which against production means dropping columns to match whatever
your working tree happens to say.

---

## Why declaration rather than detection

The guard could have tried to *recognise* the production URL — hostname
patterns, a `dev` substring, a branch id. That would be a guard that fails open
on exactly the case it exists for: a production URL that doesn't match the
pattern gets waved through, silently, and you'd never know the protection had
stopped working.

A developer stating which database they're pointing at can't fail that way. It
costs one line, once.

---

## Two things this does not solve

**The seed data is a copy of real customer records.** A Neon branch with data
included means real names and messages on your laptop. That is far better than
*writing* to production, but it is still personal data at rest on a developer
machine — worth deleting the branch when you're done with it, and worth
thinking about before adding a second developer.

**There is still no staging.** A dev branch protects the database; it does not
give you a place to test a deploy before production sees it. That is a separate
task on the board.
