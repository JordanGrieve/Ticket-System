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

Neon branches are copy-on-write clones: instant, and included on the free plan.
A schema-only branch gives you the real schema with none of the real rows.

1. **Neon console → your project → Branches → New branch.**
   - Name: `dev`
   - Parent branch: `production`
   - **Auto-delete: Never.** It defaults to *After 1 day*, which would silently
     destroy your dev branch tomorrow and start failing local dev for no
     visible reason.
   - **Branch schema only** — NOT “Branch data and schema”.

   Schema-only is the important one, and it is the opposite of what the first
   version of this page recommended. A branch *with data* is a copy of real
   customer names, addresses and support conversations sitting on a laptop.
   Schema-only gives you the real schema and no personal data at all, and
   `db:seed-dev` fills it with believable fakes — so you lose nothing except
   the risk.
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

   **If `db:migrate` exits 1 with no error message, this is why.** A
   schema-only branch copies the `public` tables but NOT drizzle’s
   `__drizzle_migrations` records. Drizzle therefore believes nothing has been
   applied, tries to run 0000 from the top, hits "relation already exists" —
   and swallows the error behind its spinner, exiting non-zero and silent.

   The fix is to build the branch purely from migrations, which is better
   anyway: it is the only thing that ever proves the migration chain works from
   zero, and a dev database whose history matches the repo exactly cannot drift
   from it.

   ```sql
   -- On the DEV branch only. Check the hostname twice.
   DROP SCHEMA public CASCADE; CREATE SCHEMA public;
   DROP SCHEMA IF EXISTS drizzle CASCADE;
   ```

   Then `npm run db:migrate` again. It should report
   `migrations applied successfully!`.

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
| `npm run db:generate` | — not guarded | It diffs schema files and writes SQL without ever opening a connection. Guarding it would be a false positive, and a false positive teaches you to type the production override for harmless commands until it stops meaning anything |
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

**Nothing guards a tool that doesn't run this code.** `psql`, the Neon SQL
editor and any GUI client connect with whatever string you paste into them. The
guard protects the repo, not your hands.

**There is still no staging.** A dev branch protects the database; it does not
give you a place to test a deploy before production sees it. That is a separate
task on the board.
