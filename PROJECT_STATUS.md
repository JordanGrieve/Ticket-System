# Postbox — Project Status

**Date:** 11 October 2026
**Repo:** `JordanGrieve/Ticket-System` (public) · **Live:** https://postbox.help

This replaces the 23 August version in full. That one described a product
waiting on Amazon SES; SES has since been removed, campaigns have sent to real
subscribers through Resend, billing and usage limits exist, and the whole
interface was rebuilt to WCAG 2.2 AAA. Nearly every section of the old
document was wrong, so it was rewritten rather than patched. `BACKEND-REVIEW.md`
(11 Sep) carries a status note at the top saying which of its findings still
stand; `docs/NEWSLETTER.md` is current as of today.

## What Postbox is

A multi-tenant SaaS support inbox for small businesses. A client points their
website's contact form and support email at Postbox and everything becomes a
threaded ticket they reply from; replies go out as real branded email and
customer responses thread back into the same ticket. Since September it also
carries the client's newsletter: a signup form, a welcome email, a composer
with an image and products, and a send pipeline.

Built on Next.js 16.3.8, React 19.2, Neon Postgres (Drizzle), Clerk (production
instance, Google OAuth), Resend (all mail, inbound and outbound), Stripe
(billing), Sentry. Deployed on Vercel in London next to the database.

## Current state

**The support inbox is live in production with real clients.** Contact-form
and email ingestion, threading, replies, notifications, auto-replies, labels,
search, snooze, archive, trash, named forms with their own keys, a team of up
to ten per workspace, an access log of operator visits, a data export.

**Newsletters are live.** The first real campaign went out on 14 September
through Resend (6 delivered, 0 failed). Signup is single opt-in by default
with a welcome email the client customises; a workspace can be put back on
double opt-in from the operator console. Campaigns go to every confirmed
subscriber in the workspace; the "lists" concept is no longer on the send
path. Bounces and complaints from Resend suppress the address.

**Billing is wired and partly enforced.** Stripe checkout and portal, a
signature-verified webhook, plans derived from the price id. Prices were
signed off on 11 September at £12 / £29 / £59. The trial is 30 days or 100
tickets, 100 subscribers and 500 emails, whichever runs out first. Per-plan
monthly email allowances (3,000 / 15,000 / 80,000) are enforced at send time;
the ticket and subscriber caps are metered but never block a customer.

**Quality gates.** CI runs typecheck, lint, 1,697 tests across 116 files, and
a production build on every push. Five render harnesses draw every signed-in
screen without a login so the accessibility probes can sweep them. The
product is held to WCAG 2.2 AAA (`STYLE-GUIDE.md`).

**Dependencies.** Next.js 16.3.8 as of 11 October, which closed seven
advisories including an SSRF in image optimisation. `npm audit` shows five
highs, all one root cause (braces, reached through eslint-config-next) with no
patched version published anywhere; lint-time only.

## What changed since 23 August, by theme

**Mail provider.** Amazon denied SES production access on 26 August. On 11
September `CAMPAIGN_DELIVERY_MODE=resend` was added and on 14 September the SES
adapter, its SNS webhook, five env vars and two docs were deleted (about 2,970
lines). Campaigns, ticket replies and welcome emails now share one Resend
account and one monthly allowance. The daily cap on the free plan (100 a day)
is counted and reported to Sentry at 80% and at the cap, never enforced
against a customer's message.

**Newsletter product.** Lists removed from the send path (every list was
empty: nothing had ever created one from a screen). Welcome email, on by
default, with the client's branding, image and products. Single opt-in with a
per-workspace confirmation switch. Hero image and a two-across products grid
in campaigns, from URLs on the client's own shop. "Send now" sends inside the
request rather than waiting for the hourly sweep. Duplicate a sent campaign.
Delete a draft. A campaign that stops because the month's allowance is spent
says so on screen. Test sends render the same email as the real send.

**Billing and limits.** Stripe end to end. `usage_counters` per workspace per
month; the send loop budgets a batch against the remaining allowance before
claiming a row and fails closed if the counter cannot be read.

**Ingestion.** Named forms, each with its own key, workspace key still
accepted. Submissions are read by meaning so Shopify, WordPress and Elementor
field names all work. The pasteable JavaScript snippet was deleted (no selector
is right for every site); the install page offers an AI prompt and a
point-your-form-here mode. Key rotation moved to the operator console with
type-the-name confirmation and an audit row.

**Operator console.** Accounts browser, billing roll-up, per-client health,
feedback drops, quiet-workspace detection, impersonation with a hash-chained
access log and a chained admin action log. The client sees who visited.

**Front end.** Two themes (light and dark, down from six). Every surface
rebuilt for phones: burger drawer, folder strip, swipe rows, bottom sheets.
Every font size in rem; every control 44px; AAA contrast measured on the
rendered page. Tailwind removed. Public pages have a reading width and
structural accessibility guards.

**Project hygiene.** Dev database with a guard that refuses production from a
laptop. Daily health check to Sentry. Every stylesheet parsed in CI. Fixtures
without casts. See `AGENTS.md` for the rules each of these produced.

## Known gaps

Ordered by how much they matter. The first four are from `BACKEND-REVIEW.md`
and are still open.

1. **Email verification is never checked when an address claims an invite or
   elevates to super-admin.** Safe today only because sign-in is Google OAuth
   alone. Half an hour to fix.
2. **`/api/inbound` has no rate limit.** Every other public write path has two
   durable buckets.
3. **The inbound webhook still accepts its shared secret from the query
   string**, where it lands in access logs. The signature path is preferred
   and the code says to retire the query form once Resend's webhook is
   repointed to the header. Whether it has been could not be checked from the
   repo. The reply-token compare was made constant-time on 11 October; the
   shared-secret compare is still a plain equality.
4. **Test sends bypass the plan entitlement.** They count against the daily
   quota but an expired trial can still send one message per call.
5. **Stripe webhook has no event dedupe and ignores invoice events.**
   Out-of-order delivery can write stale plan data over newer state.
6. **Consent is enforced in application code only**, at materialisation.
   Suppression has three SQL backstops; consent has none.
7. **Nothing detects a dead sweep.** GitHub disables scheduled workflows after
   60 days without a commit; health can say "not configured" but not "no tick
   for three days".
8. **Auto-reply delays of 5 minutes and 1 hour are in the type and nothing
   schedules them.** Hidden in the UI; `SUPPORTED_DELAYS` is still immediate
   only.
9. **Invites have no token and no expiry.** No Clerk webhook, so a deleted
   Clerk user leaves a live agent row.
10. **No integration tests run SQL.** Every query is mocked. The next serious
    bug will be in a query and nothing would catch it.
11. **No staging.** Pushes to `main` deploy straight to production with live
    clients aboard. `DEPLOYMENT.md` has the ten-minute setup.
12. **Backups** are Neon's built-ins only.

## Things only Jordan can do

`HUMAN_ACTIONS.md` is the list. The two that matter most, both open since
August: rotate the three secrets that passed through chat transcripts (Clerk
live key, Neon password, Resend key), and turn on 2FA for the Google account
and the Clerk dashboard. Nothing in the repo can tell whether either has
happened, which is why every review keeps raising them.

## Risks

- **Repo is public.** No secrets in code or history (verified again 11 Oct),
  but the documents in it describe the product's own weaknesses. Keep PII in
  the database and keep this file honest rather than flattering.
- **Bus factor 1.** One operator, one admin account.
- **One shared sending reputation.** Every tenant's mail leaves through one
  Resend account and, for campaigns, one marketing address with the client's
  name in front of it. A careless tenant's complaints degrade everyone's
  delivery. The 500-email trial ceiling, the suppression on bounce and
  complaint, and the welcome email's unsubscribe link are the controls.
- **Resend free plan.** 3,000 a month and 100 a day, shared by everything.
  The cap is reported, not enforced; the first active client needs the paid
  tier (`PRICING.md`).
- **Vercel Hobby forbids commercial use.** Upgrade before the first invoice.
- **PECR instigator liability lands on Postbox, not only the client.** The
  consent evidence is captured; the acceptable-use warranty from clients is
  not written.
- **Neon Free compute.** Scheduled jobs wake the database on a fixed cadence
  whatever the client count. A chattier cron suspends the whole product when
  the allowance runs out; that is why "Send now" sends inline instead.

## Lessons kept from the earlier versions

- **A missing secret that disables a check is worse than no check.** The
  inbound webhook once shipped world-writable whenever its secret was absent.
  Every gate since fails closed.
- **Config that throws at import time takes the app down.** Pure modules take
  server values as arguments and never import `lib/config`.
- **Documentation drifts silently and dangerously.** A safety claim that has
  become false is load-bearing for the next person's judgement. This file
  carries a date for that reason; distrust it past a month.
- **Use the feature once, in a browser, before saying it is done.** The first
  real campaign showed a From line of "newsletter" and a doubled comma in the
  postal address. No test in the repo could have seen either.
- **A grep for one spelling of a write is not proof that no write exists.**
  The repo writes SQL in two styles; search for the table name.
- **SES overwrites custom Message-IDs; Resend's inbound webhook carries
  metadata only; Resend needs the inbound MX at the apex.** All three cost
  days and all three are now built around.
