# Deployment & environments

Current as of 11 October 2026. The earlier version described an Amazon SES
configuration that was removed on 14 September; none of it applies.

## How production deploys work

- Push to `main` → GitHub Actions CI runs → Vercel builds and deploys. The
  two are independent: Vercel does not wait for CI, so a red CI run with a
  green deploy is possible and has happened. Read the Actions tab.
- **Migrations run on deploy**: `vercel.json` sets
  `buildCommand: "npm run db:migrate && npm run build"`, so the schema lands
  before the code that depends on it. A deploy with no new migrations is a
  no-op.
- Functions are pinned to `lhr1` (London) next to the Neon database. Keep the
  region pin; it roughly halves request latency.
- `npm ci` on Vercel and in CI runs on npm 10. The lockfile has to be one
  npm 10 accepts; npm 11 writes a different tree for optional peers and npm 10
  refuses it. The lockfile commits explain the workaround when it bites.

## CI

`.github/workflows/ci.yml` runs on every push and PR, in this order and on
purpose: `npm run typecheck` (which runs `next typegen` first, because route
types are generated), `npm run lint`, `npm test` (Vitest, 1,697 tests), then
`npm run build`. Typecheck is first because both build breakages this repo
has had were parse errors no linter can see; `AGENTS.md` has the story.

The build uses dummy env values declared in the workflow. Every page is
dynamic, so nothing contacts a real service at build time; a page that runs
queries during static generation would start failing CI and should be kept
dynamic.

## Scheduled jobs

All scheduling is **GitHub Actions**, not Vercel Cron. The Hobby plan rejects
sub-daily cron expressions, and Actions schedules are free. Three workflows,
each with `workflow_dispatch` for a manual run:

| Workflow | Calls | Cadence | Why that cadence |
| --- | --- | --- | --- |
| `campaign-sweep.yml` | `GET /api/cron/campaigns` | hourly | Each tick wakes the Neon compute. Five-minute sweeps ran at roughly 180 CU-hours against a 100-hour free allowance, and Neon answers an overage by suspending the compute. "Send now" sends inside the request, so the hour only governs scheduled campaigns and the safety-net pass. |
| `auto-reply-sweep.yml` | `GET /api/cron/auto-replies` | every 15 minutes | Drains enquiries held outside business hours once the workspace opens. |
| `health-check.yml` | `GET /api/cron/health` | daily, 09:00 UTC | Quiet workspaces, stalled campaigns, rejected ingestion, the daily email quota, all pushed to Sentry. |

`SWEEPS_PER_DAY` in `lib/campaign-schedule.ts` is 24 and every on-screen
estimate derives from it; `SWEEP_CADENCE` turns it into words so prose cannot
drift from the schedule. If you change the cron line, change the constant.

Things to know:

- **Two secrets stores, one value.** The workflows read the repository secret
  `CRON_SECRET`; the routes read the Vercel env var `CRON_SECRET`. They must be
  byte-identical. The workflows also need a repository **variable** `APP_URL`
  holding the deployed origin.
- **Schedules are best effort.** GitHub delays runs under load, drops them
  with no backfill, and **disables a scheduled workflow after 60 days without
  a commit to the repository**. If campaigns or held auto-replies stop
  draining, look at the Actions tab before suspecting the code.
- **A failed tick is a red run.** The curl uses `--fail-with-body`, so a
  non-2xx fails the job and logs the status and body. A cron that silently
  401s for weeks is the failure mode that cost five weeks on `/api/inbound`.
- **Every cron route fails closed.** `authorizeCronRequest` returns 503 to
  every caller while `CRON_SECRET` is unset; 401 means the two copies differ.
  The campaign sweep 503s again, separately, without `CAMPAIGN_FROM_ADDRESS`.
- `maxDuration = 60` on the campaign route must stay in step with
  `FUNCTION_BUDGET_MS` in `lib/campaign-cron.ts`, which the batch size is
  derived from. The inline "Send now" pass uses a shorter twelve-second budget.
- Delayed auto-replies (5 minutes, 1 hour) are still unsupported;
  `SUPPORTED_DELAYS` is immediate only. The auto-reply sweep drains the
  out-of-hours queue, not arbitrary jobs.

## Staging (recommended, needs dashboard access, still not set up)

Vercel gives every branch a preview deployment. To make previews a safe
staging environment rather than a copy of production:

1. **Neon**: create a branch of the production database (schema only, see
   `docs/DEV-DATABASE.md` for why). It gets its own connection string.
2. **Vercel**: Settings → Environment Variables → add a `DATABASE_URL` scoped
   to **Preview** only, pointing at that branch, plus `DATABASE_ENV=development`.
   Leave `RESEND_API_KEY` unset in Preview so no mail leaves, or set it to the
   placeholder; `lib/email.ts` skips sending either way.
3. **Clerk**: previews use the production instance, which is domain-locked to
   postbox.help, so sign-in on a preview fails unless you also add a
   Preview-scoped `pk_test` / `sk_test` pair from the development instance.
4. Work on a branch → open a PR → test on the preview URL → merge to `main`.

## Environment variables

Source of truth is Vercel → Settings. `.env.example` lists every variable with
the reasoning beside it. Gotchas learned the hard way:

- Env edits do **nothing** until the next deploy, and "Redeploy" on an old
  deployment rebuilds the *old commit*.
- Values go in **without quotes**.
- `INBOUND_EMAIL_DOMAIN` is the **root** domain; Resend requires the MX at
  the apex.
- Rotating any secret means updating the provider, Vercel, **and** `.env.local`.

### Campaign sending

Two gates, both unset by default, both failing closed on their own. The
pipeline is complete and inert until both are opened deliberately.

| Variable | Effect when unset |
| --- | --- |
| `CRON_SECRET` | The sweep route 503s to every caller, the scheduler included. Set it in **both** Vercel and the GitHub repository secrets. |
| `CAMPAIGN_FROM_ADDRESS` | The sweep 503s before constructing a deliverer. No fallback to `replies@`: a marketing complaint against the primary domain would degrade the reputation carrying every tenant's ticket replies. Must be on a domain verified with Resend. The workspace's name is put in front of it per send. |
| `CAMPAIGN_DELIVERY_MODE` | The log deliverer: records what would have been sent, mints a synthetic message id, contacts nobody. Only the exact string `resend` selects the real provider. `ses`, left over from the Amazon experiment, now means log too, by design: a stale variable must not turn into a failing sweep or a surprise send. |

Nothing else is needed for campaigns: Resend is already configured for
transactional mail and campaigns spend the same monthly allowance. That is
also why `RESEND_API_KEY` being present is deliberately **not** read as
permission to mail a subscriber list.

### Everything else that fails closed

`STRIPE_WEBHOOK_SECRET` (every webhook refused), `SUBSCRIBE_TOKEN_SECRET`
(signups refused with a 503, falling back to the inbound secret so the
feature is not dead on arrival), `RESEND_WEBHOOK_SIGNING_SECRET` or
`INBOUND_WEBHOOK_SECRET` (inbound mail refused). `STRIPE_SECRET_KEY` unset
simply means billing says it is not set up; a missing billing key cannot take
the inbox down.
