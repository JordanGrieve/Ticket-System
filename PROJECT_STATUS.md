# Postbox — Project Status

**Date:** 1 August 2026 (updated after the evening Asana work run)
**Repo:** `JordanGrieve/Ticket-System` (public) · **Live:** https://postbox.help
**Note:** the evening run's 9 commits (tests → a11y) are **local, not yet pushed** —
production still runs the morning state until the next push.

## Overview

Postbox is a multi-tenant SaaS support-ticket system: a small business connects its
website contact form and support email, and everything becomes a threaded ticket
inbox they reply from — replies go out as real branded email, and customer
responses thread back into the same ticket. Built on Next.js 16 + Neon Postgres
(Drizzle) + Clerk (production instance) + Resend, deployed on Vercel (London,
colocated with the database). **Current state: v1 is live in production with its
first real pilot client (Open Door Bakery) actively onboarded.** Two full audits
have been run and every critical finding from both is fixed and deployed.

## Where we are now

- Production is healthy at postbox.help: invite-only sign-up, full email
  closed-loop (form → ticket, email → ticket, reply → threaded email, customer
  reply → threads back), admin tier, client notifications.
- Database is clean: one real client workspace, zero test debris, 25 commits on
  `main`, working tree clean, no TODO/FIXME anywhere in source.
- No test suite and no CI — every change so far verified by hand-written
  throwaway scripts against the live system (effective, but not repeatable).
- Three security chores remain on the human side (2FA, secret rotation, one
  orphan auth user) — see Blockers.

## Completed

- **Core product v1** — multi-tenant inbox, ticket threads, replies, statuses,
  source badges (contact form / email / order with `ORD-…` auto-detection).
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
- **Admin (operator) tier** — /admin overview of all clients, act-within any
  workspace, add admins, resend invites, delete workspaces (type-the-name
  double-confirmation).
- **Notifications** — new tickets and customer replies email the workspace, with
  a loop guard so forwarded mailboxes can't create infinite ticket loops.
- **Security hardening (audits 1 & 2)** — per-ticket secret reply tokens
  (blocks cross-tenant mail injection), webhook idempotency by Message-ID,
  input length caps on all public surfaces, reply rate limiting (30/min),
  Clerk `authorizedParties`, tenant isolation verified by live tests.
- **Resilience & UX** — branded error/404/loading pages, self-refreshing inbox
  (45s) and threads (30s), viewer-timezone timestamps, honest UI copy, install
  page with copy-paste snippets plus an "AI prompt" integration mode.
- **First client onboarded** — pilot client signed up, claimed their workspace,
  and ran a full form → ticket → reply → threaded-response conversation.

**Added in the evening work run (local commits, pending push):**

- **Automated test suite** — Vitest, 27 unit tests over the parsing/threading
  logic; `npm test`.
- **CI + migrate-on-deploy** — GitHub Actions (tests + dummy-env build);
  Vercel `buildCommand` now runs migrations before building; `DEPLOYMENT.md`
  documents the staging recipe.
- **Public landing page** — `/` now markets to signed-out visitors (dashboard
  moved to `/inbox`); Terms + Privacy pages live at `/terms` & `/privacy`.
- **Contacts page** — the silently-collected contacts table is finally visible.
- **API-key rotation & admin removal** — both with guards.
- **Pagination** — 50/page inbox with SQL counts; 200-message thread cap; and
  the paging test caught a real clock-skew ordering bug (fixed: DB clock
  everywhere).
- **Accessibility pass** — menu Esc/click-outside semantics, focus-visible
  rings, reduced-motion support, input labels.

## In progress

- **Pilot period with the first client** — watching real usage for rough edges;
  no code mid-flight at the time of writing.

## Remaining work

- **Push + deploy the evening run** (9 local commits) — then the staging
  dashboard steps in `DEPLOYMENT.md` (Neon branch + Preview env vars, ~10 min).
- Error monitoring — blocked on a Sentry DSN (account needed); wiring is ready
  to go once provided.
- Upstash Redis rate limiting — blocked on Upstash credentials; not urgent.
- Responsive mobile layout (split from the a11y pass — visual work).
- Workspace teams — multiple logins per client (split; schema already allows it).
- GDPR self-service data export (split; privacy policy promises on-request
  handling meanwhile).
- Professional review of the Terms/Privacy drafts before serious scale.
- DMARC `rua` still points at a GoDaddy leftover address (60-second Cloudflare
  edit).

## Blockers

All three are human/dashboard actions, not code:

1. **Admin account has no 2FA** (confirmed via Clerk API) — the super-admin can
   read every client's data; this is the top security gap.
2. **Secret rotation pending** — the Clerk `sk_live`, Neon DB password, and
   Resend API key were all exposed in an AI chat transcript during setup and
   should be rotated (then updated in Vercel + `.env.local`).
3. **One orphan production auth user** — leftover test signup in Clerk to delete.

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

## Risks & other notes

- **Repo is public** — fine today (no secrets in history, verified), but keep it
  in mind for anything sensitive; PII stays in the database, never the repo.
- **Bus factor 1** — a single admin account and a single operator.
- **No backups story** beyond Neon's built-ins; no `pg_dump` routine.
- **Deliverability** — postbox.help is a young sending domain; early test blasts
  briefly hit Gmail spam. Real varied traffic + time should settle reputation.
- **Name collision** — "Postbox" is an existing email product; fine at this
  scale, worth a think before serious marketing.
- Deploys go straight to production on push to `main` with a live client aboard —
  staging (above) is the mitigation.
