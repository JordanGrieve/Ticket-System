# Deployment & environments

## How production deploys work

- Push to `main` → GitHub Actions CI runs (unit tests + a production build with
  dummy env vars) → Vercel builds and deploys.
- **Migrations run automatically on deploy**: `vercel.json` sets
  `buildCommand: "npm run db:migrate && npm run build"`, so the schema always
  lands before the code that depends on it. Drizzle migrations are idempotent —
  a deploy with no new migrations is a no-op.
- Functions are pinned to `lhr1` (London) to sit next to the Neon database
  (eu-west-2). Don't remove the region pin — it roughly halves request latency.

## CI

`.github/workflows/ci.yml` runs on every push/PR: `npm ci`, `npm test`
(Vitest), `npm run build`. The build uses **dummy env values** — every page is
dynamic, so nothing contacts real services at build time. If you add a page
that runs queries at build time (static generation), CI will start failing:
that's a design smell here, keep pages dynamic.

## Staging (recommended setup — needs dashboard access)

Vercel gives every branch a **preview deployment** automatically. To make
previews a safe staging environment rather than a copy of production:

1. **Neon**: create a branch of the production database (Neon → Branches →
   New branch). This gives an isolated copy-on-write DB with its own
   connection string.
2. **Vercel**: Settings → Environment Variables → add a `DATABASE_URL` scoped
   to the **Preview** environment only, pointing at the Neon branch. Add
   Preview-scoped `INBOUND_WEBHOOK_SECRET`/`RESEND_API_KEY` (or leave Resend
   unset in Preview so emails are skipped, which `lib/email.ts` handles).
3. **Clerk**: preview URLs use the *production* Clerk instance, which is
   domain-locked to postbox.help — sign-in on previews will not work unless
   you also add a Preview-scoped pair of `pk_test`/`sk_test` (the development
   instance). That combination gives working auth on previews with dev users.
4. Work on a branch → open a PR → test on the preview URL → merge to `main`
   to ship.

## Environment variables (source of truth: Vercel → Settings)

See `.env.example` for the full list. Gotchas learned the hard way:

- Env edits do **nothing** until the next deploy; "Redeploy" on an old
  deployment rebuilds the *old commit*.
- Values must be pasted **without quotes**.
- `INBOUND_EMAIL_DOMAIN` is the **root** domain (Resend requires apex MX).
- Rotating any secret = update the provider, Vercel, *and* `.env.local`.
