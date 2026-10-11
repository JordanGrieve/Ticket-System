# Postbox — a support inbox and newsletter for small businesses

A standalone multi-tenant SaaS product. A business connects its website
contact form and its support email, and everything becomes a threaded ticket
inbox it replies from. Replies go out as real email from
`"Business Name" <replies@postbox.help>` and the customer's reply threads back
into the same ticket. The same workspace carries the business's newsletter: a
signup form for its site, a welcome email in its own branding, a composer with
an image and products, and a send pipeline with unsubscribe and suppression.

Live at `postbox.help`. Its own repo, database and domain, completely separate
from any client site. See `PROJECT_STATUS.md` for where things stand,
`DEPLOYMENT.md` for the pipeline, `STYLE-GUIDE.md` before touching a screen,
and `AGENTS.md` for the engineering rules this codebase learned the hard way.

## Stack

- **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript
- **Neon** Postgres via **Drizzle ORM**
- **Clerk** for sign-in (production instance, Google OAuth)
- **Resend** for every email: ticket replies, notifications, auto-replies,
  welcome emails, campaigns, and inbound parsing
- **Stripe** for billing, **Sentry** for errors
- **Vercel** (London) for hosting, **GitHub Actions** for CI and every
  scheduled job

## How it works

```
Client website form ──▶ POST /api/tickets/:key ─────▶ ┐
Forwarded email ──────▶ POST /api/inbound (Resend) ──▶ ├─▶ tickets + ticket_messages
                                                       ┘          │
                         Dashboard (Clerk-authed) ◀───────────────┘
                         reply ─▶ Resend ─▶ customer ─▶ Reply-To: ticket+TKT-<id>-<secret>@postbox.help
                                                         └─▶ POST /api/inbound threads it back

Signup form ──▶ POST /api/subscribe/:key ──▶ subscribers ──▶ welcome email
Composer ─────▶ campaign_recipients ──▶ hourly sweep / Send now ──▶ Resend ──▶ bounces suppress
```

**Tickets** arrive three ways and land in one inbox: a contact-form POST with
a workspace or form key (CORS-enabled; fields are read by meaning so Shopify,
WordPress and Elementor names all work), an email forwarded to the workspace's
inbound address, and the same email flow with an order number in it, which
makes a higher-priority `order` ticket. Replies to a ticket carry a per-ticket
secret in the Reply-To address, so a sequential id alone cannot be used to
mail into another tenant's thread. Enquiries outside the workspace's business
hours get a held auto-reply once it opens.

**Newsletters** are single opt-in by default (an operator can put a workspace
back on double opt-in), with consent evidence recorded on every row. Campaigns
go to every confirmed subscriber in the workspace. Sending claims one
recipient row at a time before calling the provider, so a crash loses at most
one email and never sends one twice.

## Multi-tenancy

- Every ticket, message, contact, subscriber and campaign carries a
  `workspace_id`, and every statement that touches them carries the predicate
  *inside* the statement. `tests/tenancy-invariants.test.ts` reads every raw
  SQL statement in the repo and fails if one does not.
- Public endpoints identify the workspace by key only. The dashboard takes
  the workspace from the Clerk session, never from the request.
- Public write paths are rate-limited per key in Postgres, so the limits hold
  across serverless instances.
- Operators act inside a client workspace only with an open, hash-chained
  audit session; the client sees the visits in Settings → Access log.

## Project layout

```
app/
  page.tsx, pricing/, contact/, (legal)/     Public marketing and legal pages
  (dashboard)/
    inbox/                                   The inbox, folders, labels, search
    tickets/[id]/                            A thread, with the contact rail
    newsletters/, newsletters/welcome/       The composer and the welcome email
    subscribers/                             The subscriber list
    settings/                                General, install, forms, labels, team,
                                             auto-reply, billing, contacts, access log
  (admin)/admin/                             The operator console
  s/, u/                                     Subscribe and unsubscribe pages a client's customer sees
  api/                                       Route handlers: tickets, inbound, campaigns,
                                             subscribe, billing, webhooks, cron, workspace
components/                                  mail/, newsletter/, marketing/, skeletons/
lib/                                         Domain logic; pure halves beside their IO halves
db/                                          Drizzle schema, migrations, guard, seed scripts
tests/                                       Vitest; render harnesses for every signed-in screen
proxy.ts                                     Clerk route gating; the public-route list lives here
```

## Local setup

1. `npm install` (npm 10, Node 22).
2. Copy `.env.example` to `.env.local` and fill in Neon, Clerk and Resend.
   Read the comments; most variables explain what happens when they are unset.
3. **Make a development database.** `db/guard.ts` refuses to connect from a
   laptop unless `DATABASE_ENV=development` declares one. `docs/DEV-DATABASE.md`
   is the two-minute setup with a schema-only Neon branch.
4. `npm run db:migrate` then `npm run db:seed-dev` for believable fake data.
5. `npm run dev`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `next typegen` then `tsc --noEmit`. Run it after your last edit, not before |
| `npm run lint` | ESLint with the keyboard half of jsx-a11y turned on |
| `npm test` / `test:watch` | Vitest |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | drizzle-kit. `db:push` is the sharp one |
| `npm run db:seed-dev` | Fake data for the dev branch |
| `npm run db:seed` / `db:seed-client` / `db:bootstrap` | Demo workspace, a client workspace, first admin |
| `npm run db:rekey-chains` | Re-key the audit hash chains (see `lib/rekey-chain.ts` before running) |

## Deploying

`DEPLOYMENT.md`. In short: push to `main`, CI runs typecheck, lint, tests and
a build, Vercel deploys with migrations in the build command. Resend needs a
verified sending domain, the inbound MX on the root domain, and two webhook
endpoints (inbound mail, and delivery events). Clerk needs the production
domain. Scheduled sweeps run from GitHub Actions and need `CRON_SECRET` in two
places.

## Installing on a client's site

Settings → Install gives a client two ways to connect a contact form and one
to add a newsletter signup. The recommended way is a prompt to hand to
whatever AI assistant built their site: it can see the page, so it finds the
real form and keeps the markup and styling as they are. The no-code way points
an existing form's `action` at the endpoint, at the cost of the visitor
landing on a Postbox confirmation page. Each named form has its own key, so
one scraped page does not take down every form the business has.
