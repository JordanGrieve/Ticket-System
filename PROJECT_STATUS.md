# Postbox — Project Status

**Date:** 23 August 2026
**Repo:** `JordanGrieve/Ticket-System` (public) · **Live:** https://postbox.help
**Head:** `0e71257` · 24 commits on 23 August alone — see “What changed on 23 August” below

## What changed on 23 August

A long day. In rough order of how much they matter:

**The goal moved and then stalled.** Newsletter signup was verified end to end
in production (a real double opt-in, consent evidence written, an audience that
finally selects non-empty). A real message was sent through Amazon SES and its
headers inspected: SPF, DKIM and DMARC all pass, one-click unsubscribe present,
CAN-SPAM footer carrying the postal address. Gmail filed it as Spam — reputation,
not authentication, and expected for a subdomain that had never sent.

Then **Amazon DENIED production access** (case 178747420600793). Enforcement is
HEALTHY, so this is not a reputation problem. The eu-west-1 form has no
free-text field, so the request is judged against the website — which described
only the support-ticket product. The homepage now describes the newsletter side
too. The case must be REPLIED to, not reopened as a new one.

**Two silent failures were found, both of the same shape.** The tenancy guard —
the control proving every raw SQL statement carries its workspace predicate —
had been passing while blind to most of the code it policed: its extractor
missed typed `sql<T>` fragments entirely and truncated any statement containing
a nested template, including the INSERT that decides which tenant a campaign
recipient belongs to. And CI had been red for six commits without anyone
noticing, because Vercel kept deploying (it sets VERCEL_ENV, which the new
database guard accepts) and the only signal was a tick nobody read.

**Local development stopped running against production.** There was never a dev
database; every dev server, seed script and ad-hoc query hit live customer
records. There is now a schema-only Neon branch with fake data, and db/guard.ts
refuses any database not declared as development. See docs/DEV-DATABASE.md.

**Things that now notice when they break**: a quiet-workspace detector (the
admin console showed Open Door Bakery as “No enquiries yet” for the six weeks its
contact form was broken), rejected-ingestion logging, per-campaign stall
diagnosis, and a daily Sentry sweep that pushes all of it.

**Smaller, but real**: rate limits now hold across instances; impersonation
access expires on the heartbeat without writing a false end time to the audit
log; clients can invite a teammate; Settings gained Labels and Team; the Sent
folder exists; bare links stopped failing contrast on four of six themes.

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
client (Open Door Bakery). The newsletter feature is built end to end, is now
lawful to send, and is switched off pending Amazon SES production access.**

What changed late on 22 August, in case the sections below still disagree:
newsletter signup with double opt-in shipped and was verified end to end in
production (one confirmed subscriber, with consent method, timestamp, page URL
and IP recorded); marketing consent is enforced in `selectAudience`; the
CAN-SPAM postal address is captured in Settings and the send is refused without
it; the SES bounce/complaint webhook is built and the AWS topic wired; the
sweep moved from Vercel Cron to GitHub Actions every five minutes; and the
composer gained a **Send a test to myself** action so the delivery path can be
exercised without spending the one real subscriber.

A long-standing bug was also found and fixed: Open Door Bakery's website
contact form had been failing for every visitor for six weeks (a stale key in
their `POSTBOX_TICKET_URL`, so Postbox correctly returned 401). Postbox
surfaced this to nobody, which is now tracked as a product gap.

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
- **Auto-reply engine** — business-hours aware, with loop guards. Enquiries
  arriving outside a workspace's hours are HELD in `auto_reply_queue` and sent
  shortly after it next opens, by `/api/cron/auto-replies`
  (.github/workflows/auto-reply-sweep.yml); every guard and both rate limiters
  re-run at send time, never at queue time. They used to be dropped silently.
  Only the `immediate` delay is supported; `5min` and `1hr` are still unwired —
  the queue could carry them, but nothing puts an in-hours reply into it.
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

1. **Reply to the DENIED SES case (178747420600793)** — this is the only thing
   standing between the product and its stated goal. Reply on the SAME case;
   opening a new one restarts the queue. `docs/SES-PRODUCTION-ACCESS.md` §3 is
   the detailed use-case text the console form gave nowhere to put, and the
   homepage now describes the newsletter side, which the original request was
   judged against and did not mention.

   ~~`CRON_SECRET` is probably unset~~ — DONE 23 Aug. Set in both Vercel and
   the GitHub Actions **repository** secrets, with `APP_URL` as a repository
   variable. Note the trap that cost time: they were first added as
   *environment* secrets, which are invisible to a job that declares no
   `environment:`, and resolve to empty strings with no error.

1b. **Rotate the Neon `neondb_owner` password** — a dev-branch connection string
   was pasted into a chat transcript on 23 Aug. Neon branches inherit role
   passwords from the parent, so it is very likely the production password too.
   The dev branch itself holds no customer data; the shared role is the risk.
2. **Admin account 2FA** — the super-admin can read every client's data. Google
   2FA on the sign-in path is the free stand-in; Clerk MFA is a paid add-on and
   was deliberately deferred.
3. **Secret rotation pending — STILL OPEN, oldest unresolved security item** —
   Clerk `sk_live`, Neon DB password, and Resend API key were exposed in an AI
   chat transcript during setup. Nothing in the repo can verify whether this
   was done; if it has been, tick it here, because right now every audit keeps
   re-reporting it.
4. **Vercel Pro — deferred deliberately, revisit at the first invoice.** Hobby
   is for non-commercial use; the working position is that this is a hobby
   project until it charges anyone, which is defensible while nothing is
   invoiced and stops being defensible the moment something is. The cron cap
   that used to force an upgrade is irrelevant now: the sweep is GitHub Actions
   every five minutes, outside Vercel's plan limits entirely. Pro would still
   raise `maxDuration` from 60s to 300s, which is what `RECIPIENTS_PER_SWEEP`
   is really bounded by.
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
