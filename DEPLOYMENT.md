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

## Scheduled jobs

`vercel.json` defines **one cron**, added in `7900a5c`:

```json
"crons": [{ "path": "/api/cron/campaigns", "schedule": "0 3 * * *" }]
```

Things to know before touching it:

- **It runs nightly in production right now.** Vercel invokes it with
  `Authorization: Bearer $CRON_SECRET`.
- **It fails closed on a missing secret.** `authorizeCronRequest` returns **503
  to every caller, Vercel included, while `CRON_SECRET` is unset** — deliberately,
  because an unauthenticated version of this route is a public "send everyone's
  marketing email now" button. If the cron log shows a nightly 503, the secret is
  the first thing to check; a wrong secret gives 401 instead.
- **It 503s again, separately, without `CAMPAIGN_FROM_ADDRESS`**, before any
  deliverer is constructed. There is no fallback to `replies@postbox.help`.
- **It cannot mail anyone unless `CAMPAIGN_DELIVERY_MODE` is exactly `ses`.**
  Any other value — unset, empty, `SES`, `true`, `1` — selects the log
  deliverer, which records what would have been sent and contacts nothing.
- **Daily is the Hobby-plan ceiling.** A sub-daily schedule fails *at deploy
  time* on Hobby. At `RECIPIENTS_PER_SWEEP = 75` a nightly tick moves at most 75
  recipients per campaign per day, which is far slower than the batch arithmetic
  in `lib/campaign-cron.ts` assumes — see `docs/NEWSLETTER.md` §0.9. If you
  upgrade to Pro, change the schedule and `maxDuration` together.
- `maxDuration = 60` in the route must stay in step with `FUNCTION_BUDGET_MS` in
  `lib/campaign-cron.ts`, which is what the batch size is derived from.

Nothing else in the product is scheduled. Delayed auto-replies are still
unsupported (`SUPPORTED_DELAYS` is `["immediate"]`) — this cron claims campaign
recipients, not arbitrary jobs.

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

### Campaign sending

None of these were documented before 22 August 2026, which is how a nightly cron
came to run in production against a route that refuses it for want of a secret
nobody had been told about. All are **unset by default and that is the safe
state** — the pipeline is inert without them.

| Variable | Required for | Effect when unset |
|---|---|---|
| `CRON_SECRET` | The sweep to run at all | Route 503s to every caller, Vercel's scheduler included. **Set this first**, or the cron does nothing every night. Any long random string; it must match nothing else. |
| `CAMPAIGN_FROM_ADDRESS` | The sweep to get past its envelope check | Route 503s before constructing a deliverer. Must be on the marketing subdomain (`news.postbox.help`), never `replies@` — a marketing complaint against the primary domain degrades the reputation carrying every tenant's ticket replies. |
| `CAMPAIGN_DELIVERY_MODE` | Real sending | Log deliverer: records what would have been sent, mints a synthetic message id, contacts nothing. Only the exact string `ses` selects a real provider — case-sensitive, trimmed. **This is the last switch before real mail leaves the building.** |
| `AWS_REGION` (or `SES_REGION`) | SES | With mode `ses` and this missing, the deliverer **throws** rather than falling back to log — silently degrading would look like a successful send. `eu-west-1`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | SES | Same: mode `ses` plus incomplete credentials is a hard failure, by design. `AWS_SESSION_TOKEN` is optional. |
| `SES_CONFIGURATION_SET` | Bounce/complaint events | Optional, and sending without it is a bad idea: bounce and complaint notifications are never emitted, so the feedback loop silently does not exist. The factory logs "NO configuration set" when it starts in `ses` mode. |
| `SES_TENANT_NAME` | Per-workspace SES tenant | Optional. One SES tenant per workspace is the reason SES was chosen at all (`docs/NEWSLETTER.md` §1.4), and a single process-wide value cannot express that — callers can override it per send. |
| `SES_RETURN_PATH` | Envelope return path | Optional. |

Two things this table does not tell you, both worth knowing:

- **Setting these is not sufficient to send anything.** They are three gates in
  series and every other prerequisite sits behind them. The full ordered list is
  `docs/NEWSLETTER.md` §0.
- **Setting them is also not sufficient to send anything *lawfully*.** Consent
  enforcement and the CAN-SPAM postal address are both unbuilt. Read
  `docs/NEWSLETTER.md` §0 and §7 before flipping `CAMPAIGN_DELIVERY_MODE`.
