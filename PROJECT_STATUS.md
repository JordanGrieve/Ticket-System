# Postbox — Project Status

**Date:** 22 August 2026 (rewritten; the previous version was dated 1 August and
predated the newsletter pivot entirely)
**Repo:** `JordanGrieve/Ticket-System` (public) · **Live:** https://postbox.help
**Head:** `7900a5c` · 59 commits on `main`

## Overview

Postbox is a multi-tenant SaaS support-ticket system: a small business connects its
website contact form and support email, and everything becomes a threaded ticket
inbox they reply from — replies go out as real branded email, and customer
responses thread back into the same ticket. Built on Next.js 16 + Neon Postgres
(Drizzle) + Clerk (production instance) + Resend, deployed on Vercel (London,
colocated with the database).

Since early August the project has been **extending into bulk marketing email** —
subscriber lists, campaigns, a composer, a scheduled send pipeline. That is the
bulk of recent work and none of it can send yet, deliberately. It is the reason
this document needed rewriting rather than updating: the 1 August version
described a product that no longer exists.

**Current state: v1 support inbox is live in production with its first real pilot
client (Open Door Bakery). The newsletter feature is built end to end and
switched off.**

## Where we are now

- Production is healthy at postbox.help: invite-only sign-up, full email
  closed-loop (form → ticket, email → ticket, reply → threaded email, customer
  reply → threads back), admin tier, client notifications.
- **282 automated tests** across 15 files (Vitest) — 281 passing plus one
  deliberate expected-fail that documents a known gap. It was 266 across 14 files
  a few hours earlier, so treat this number as a snapshot. CI runs them on every
  push. The 1 August document's "no test suite and no CI" and "27 tests" are both
  long out of date.
- **The newsletter pipeline is complete and inert.** Composer, audience
  materialisation, claim-before-send loop, a nightly cron worker, an SES
  integration and an RFC 8058 unsubscribe endpoint all exist. Four independent
  gates keep it shut; the ordered list of what actually blocks a send is
  `docs/NEWSLETTER.md` §0 and it is the single most useful page in the repo right
  now.
- No TODO or FIXME anywhere in `lib/`, `app/`, `components/` or `db/`.
- Human/dashboard chores still outstanding: 2FA, secret rotation, `CRON_SECRET`,
  Vercel Pro. See `HUMAN_ACTIONS.md`.

## Completed

- **Core product v1** — multi-tenant inbox, ticket threads, replies, statuses,
  source badges (contact form / email / order with `ORD-…` auto-detection),
  search, tabbed settings.
- **Production infrastructure** — postbox.help on Vercel (`lhr1`, pinned next to
  Neon London), DNS on Cloudflare, Clerk production instance with Google OAuth,
  Resend domain verified (DKIM/SPF), inbound MX + Svix-verified webhook.
- **Email closed-loop** — outbound replies from `"Workspace" <replies@postbox.help>`;
  inbound emails become tickets (bodies fetched via Resend's API); real
  conversation threading anchored on customer Message-IDs (SES-proof); quoted
  reply history stripped; verified end-to-end in real Gmail.
- **Onboarding** — admin creates a client workspace → branded HTML invite email →
  client signs up with the invited address and lands in their prepared workspace.
  Invite-only: strangers get a polite /no-access page, never a workspace.
- **Admin (operator) tier** — /admin overview of all clients, add admins, resend
  invites, delete workspaces (type-the-name double-confirmation).
- **Impersonation with an audit trail** — acting within a client workspace
  requires an open audit row, not merely a cookie.
- **Notifications** — new tickets and customer replies email the workspace, with
  a loop guard so forwarded mailboxes can't create infinite ticket loops.
- **Auto-reply engine** — business-hours aware, with loop guards. Only the
  `immediate` delay is supported; `5min` and `1hr` need a general job scheduler
  that still does not exist.
- **Security hardening (audits 1 & 2, plus a later pass over internet-reachable
  paths)** — per-ticket secret reply tokens, webhook idempotency by Message-ID,
  input length caps on all public surfaces, reply rate limiting, Clerk
  `authorizedParties`, tenant isolation verified by live tests and by
  `tests/tenancy-invariants.test.ts`.
- **Automated test suite and CI** — Vitest over the pure logic (parsing,
  threading, rendering, audience selection, cron policy, deliverer selection,
  tenancy and impersonation invariants); GitHub Actions runs tests plus a
  dummy-env production build on every push.
- **Newsletter foundation** — `subscribers`, `lists`, `list_subscribers`,
  `suppressions`, `campaigns`, `campaign_recipients`, `sending_domains`; a pure
  renderer (`lib/newsletter.ts`) importable from a client component; idempotent
  audience materialisation.
- **Newsletter send pipeline (`7900a5c`)** — `lib/deliver.ts` factory,
  `lib/deliver-log.ts`, `lib/deliver-ses.ts`, `lib/campaign-cron.ts` policy,
  `app/api/cron/campaigns/route.ts` worker, one `crons` entry in `vercel.json`,
  and the single-page composer at `/newsletters`.
- **Unsubscribe (`14aa430`)** — `/u/[token]`, GET confirms and POST is the
  unauthenticated RFC 8058 one-click; suppression written synchronously;
  reported verified end to end.
- **Legal pages** — `/terms` and `/privacy`, both rewritten around the marketing
  feature and both explicitly marking it as not live.

## In progress

- **Send trigger** — until 22 August nothing could move a campaign out of
  `draft`, so the entire pipeline behind it was unreachable.
  `POST|DELETE /api/campaigns/[id]/schedule`, `lib/campaign-schedule.ts` and a
  composer Schedule control close that. **In the working tree, not yet on
  `main`** at the time of writing. It writes a status and a timestamp; it sends
  nothing, because delivery is still log-only.
- **Pilot period with the first client** — watching real usage for rough edges.

## Remaining work

Newsletter, in rough priority order (the authoritative list is
`docs/NEWSLETTER.md` §0):

- Consent enforcement: `selectAudience` never reads `consentAt`, so an import
  with no provenance is currently mailable. Legal teeth; blocks any real send.
- `legalName` / `postalAddress` on `workspaces` for the CAN-SPAM footer, and
  `consentIp` on `subscribers`.
- A bounce/complaint webhook writing into `suppressions`. Without it a hard
  bounce is re-mailed every campaign.
- A cross-invocation rate limiter — `lib/rate-limit.ts` is still an in-memory
  Map, and a cron can now overlap itself.
- A reconciliation sweep for rows at `sent` with no `provider_message_id`.
- `<head>` in the email shells (no charset, no viewport) — the cheapest fix in
  the repo per minute spent.

Elsewhere:

- Upstash Redis rate limiting — blocked on credentials; now more than cosmetic.
- Responsive mobile layout.
- Workspace teams — multiple logins per client (schema already allows it).
- GDPR self-service data export (privacy policy promises on-request handling
  meanwhile).
- Professional review of the Terms/Privacy drafts before serious scale.

## Blockers

Human/dashboard actions, not code. Full detail in `HUMAN_ACTIONS.md`.

1. **`CRON_SECRET` is probably unset, and now needs setting twice** — the
   campaign sweep fails closed with 503 until it is. It is documented in
   `.env.example` now, and the same value must go in both Vercel's env vars and
   the GitHub Actions repository secrets, since Actions drives the sweep. A
   `APP_URL` repository variable is needed alongside it. Three minutes to fix.
2. **Admin account 2FA** — the super-admin can read every client's data. Google
   2FA on the sign-in path is the free stand-in; Clerk MFA is a paid add-on and
   was deliberately deferred.
3. **Secret rotation pending** — Clerk `sk_live`, Neon DB password, and Resend
   API key were exposed in an AI chat transcript during setup.
4. **Vercel Pro** — Hobby prohibits commercial use. It also caps cron at once a
   day, but that is no longer the newsletter's throughput ceiling: the sweep is
   scheduled by GitHub Actions every five minutes instead (288 sweeps/day, best
   effort). Pro would still raise `maxDuration` from 60s to 300s with Fluid
   compute, which is what `RECIPIENTS_PER_SWEEP` is really bounded by.
5. **SES identity unverified from here** — `news.postbox.help` in `eu-west-1` is
   reported verified but no AWS credentials are available in the dev environment
   to confirm it, and sandbox status is unknown.

## Successes

- Zero-to-production in days: domain, DNS, production auth, verified email
  sending *and* receiving — the full loop demonstrably works in real Gmail.
- The invite → email-match claiming design gives invite-only security with zero
  friction (no codes needed — the auth provider already verifies email ownership).
- Two adversarial audits caught real vulnerabilities (open workspace
  provisioning = spam cannon; guessable reply addresses = cross-tenant
  injection) before any real customer could be affected.
- Every fix was verified against the live system with behavioral tests, not
  assumptions — several "working" assumptions were proven false this way.
- The newsletter work chose the boring correct architecture twice over: no jobs
  table (because `campaign_recipients` already is a queue, and two queues means
  two answers to "have we mailed this person"), and no auto-detected provider
  (because the failure mode of guessing is mailing forty thousand real people).

## Failures & lessons learned

- **SES overwrites custom Message-IDs** — first threading implementation minted
  its own IDs and referenced ghosts; threading never worked until rebuilt around
  customer Message-IDs + learning our own delivered IDs from reply headers.
- **Resend `email.received` webhooks carry metadata only** — inbound emails
  arrived as "(empty message)" until bodies were fetched via a second API call.
- **Shared-secret-in-URL webhooks are paste-fragile** — the stored secret never
  byte-matched (invisible paste artifact); wasted hours of 401s. Replaced with
  cryptographic Svix signature verification.
- **Clerk dev keys on a production domain** hang silently (blank spinner) — cost
  significant debugging before moving to a production instance.
- **Curl-probing protected routes is a false deploy signal** — production Clerk
  rewrites them all to 404 for non-browsers; "missing route = old deploy" caused
  a phantom deploy-failure investigation. Behavioral markers on public endpoints
  are the reliable check.
- **Resend requires the inbound MX on the root domain** — forced a late rename of
  the inbound address domain (subdomain plan abandoned).
- Early demo-workspace design ("first sign-up claims the seed") became a live
  account-takeover hole the moment the site went public — caught in audit 1.
- **A missing secret that disables a check is worse than no check** —
  `app/api/inbound/route.ts` shipped with `if (signingSecret || sharedEnabled)`,
  which left the webhook world-writable whenever the secret was absent. It built
  cleanly and logged nothing. The campaign cron's auth was written to fail closed
  specifically because of this.
- **Config that throws at import time takes the app down** — `071f6df` was a
  hotfix for exactly that on `/inbox`. It is why `lib/newsletter.ts` and
  `lib/campaign-cron.ts` are forbidden from importing `lib/config`, and why
  server-only values are passed as arguments.
- **Documentation drifts silently and dangerously.** `7900a5c` shipped a worker,
  a cron and a live delivery path while leaving behind a comment in
  `lib/deliver.ts` asserting the opposite, plus two docs, two legal pages and an
  admin pane all describing the previous week's repo. A safety claim that has
  become false is worse than no claim, because it is load-bearing for the next
  person's judgement. Documents that assert absence need re-reading whenever the
  thing arrives.

## Risks & other notes

- **Repo is public** — fine today (no secrets in history, verified), but keep it
  in mind for anything sensitive; PII stays in the database, never the repo.
- **Bus factor 1** — a single admin account and a single operator.
- **No backups story** beyond Neon's built-ins; no `pg_dump` routine.
- **Deliverability** — postbox.help is a young sending domain; early test blasts
  briefly hit Gmail spam. Real varied traffic + time should settle reputation.
  The marketing subdomain split gives observability, not a firewall — Gmail's
  5,000/day bulk threshold aggregates subdomains into the primary domain, and
  bulk-sender status never expires (`docs/NEWSLETTER.md` §1.3).
- **PECR instigator liability lands on Postbox, not just the client** — reg 22
  binds whoever transmits *or* instigates. "Our client said the list was
  consented" is a defence only if contractually warranted *and* technically
  enforced, and the technical half is not built.
- **One irreversible switch** — `CAMPAIGN_DELIVERY_MODE=ses`. Every other
  mistake in this codebase can be rolled back; that one cannot, because its
  output has already left the building.
- **Name collision** — "Postbox" is an existing email product; fine at this
  scale, worth a think before serious marketing.
- Deploys go straight to production on push to `main` with a live client aboard —
  staging (see `DEPLOYMENT.md`) is the mitigation and is still not set up.
