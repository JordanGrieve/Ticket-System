# Postbox — multi-tenant support ticket system

A standalone SaaS product that turns any business's **contact form** and **inbound
email** into a clean, threaded support inbox. A business owner signs up, gets a
workspace with a unique API key, pastes a snippet onto their existing site, and
from then on submissions flow into their ticket dashboard instead of their inbox.
Replies send as real email from their address; customer replies thread back in.

This app is completely separate from any client site — its own repo, its own
database, its own domain (e.g. `support.yourapp.com`).

## Stack

- **Next.js** (App Router, Next 16) + TypeScript
- **Neon** (Postgres) via **Drizzle ORM**
- **Clerk** — one workspace login per client
- **Resend** — sends replies and parses inbound email
- Deployed on **Vercel**

## How it works

```
Client website ──▶ POST /api/tickets/:apiKey ──▶ ┐
Forwarded email ─▶ POST /api/inbound ───────────▶ ├─▶  tickets + ticket_messages
                                                  ┘         │
                        Dashboard (Clerk-authed) ◀──────────┘
                        reply ─▶ Resend ─▶ customer ─▶ (Reply-To: ticket+TKT-<id>@…)
                                                        └─▶ POST /api/inbound (threads back)
```

Three ways tickets are created, all landing in the same inbox:

1. **Contact form** — `POST /api/tickets/:apiKey` (CORS-enabled, called from the
   client's own domain). Creates a `contact_form` ticket + first inbound message.
2. **Direct email** — the client forwards mail to their workspace inbound address;
   Resend posts it to `POST /api/inbound`, which opens an `email` ticket.
3. **Order email** — same inbound flow, but the subject/body is scanned for an
   order id (`ORD-\d+` or `#\d{3,}`). A match makes it a higher-priority `order`
   ticket with the id stored.

Replies to existing tickets use a per-ticket `Reply-To` of
`ticket+TKT-<id>@inbound.yourapp.com`; when a customer replies, the ticket id is
extracted from the address and the message threads back into the same ticket.

## Multi-tenancy

- Every ticket, message, and contact carries a `workspace_id`.
- Every dashboard query is scoped to the authenticated user's workspace — data
  is never returned across workspaces (see `lib/data.ts`).
- The public ingestion endpoint identifies the workspace purely by API key and
  validates it exists before creating anything.
- The public endpoint is **rate-limited per workspace** so one client can't
  affect others (`lib/rate-limit.ts`).

## Project layout

```
app/
  (dashboard)/            Clerk-authed dashboard (route group)
    page.tsx              Ticket list (inbox)
    tickets/[id]/         Single ticket thread
    install/              Install + settings (snippet, inbound address)
  api/
    tickets/[id]/         POST = public ingestion (apiKey) · GET = authed ticket
    tickets/[id]/reply/   POST authed — send reply via Resend
    tickets/[id]/status/  PATCH authed — open/in_progress/closed
    tickets/route.ts      GET authed — list
    inbound/              POST — Resend inbound webhook (new tickets + threading)
    workspace/            PATCH authed — update reply-from address / accent
  sign-in, sign-up        Clerk pages
db/                       Drizzle schema, migrations, seed
lib/                      Domain helpers, data access, theme, rate limiting
components/               Sidebar, Inbox, TicketThread, InstallView, CopyButton
```

## Local setup

1. **Install**

   ```bash
   npm install
   ```

2. **Configure env** — copy `.env.example` to `.env.local` and fill in your
   Neon, Clerk and Resend keys.

   ```bash
   cp .env.example .env.local
   ```

3. **Create the schema** (against your Neon database)

   ```bash
   npm run db:push      # or: npm run db:migrate to apply generated SQL
   ```

4. **Seed the demo workspace** — "Riverside H&C" with sample tickets. The first
   account to sign in *claims* this workspace, so you have data to develop
   against.

   ```bash
   npm run db:seed
   ```

5. **Run**

   ```bash
   npm run dev
   ```

## Scripts

| Script              | What it does                              |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Start the dev server                      |
| `npm run build`     | Production build                          |
| `npm run db:generate` | Generate SQL migrations from the schema |
| `npm run db:migrate`  | Apply migrations                        |
| `npm run db:push`     | Push the schema directly (dev)          |
| `npm run db:seed`     | Seed the demo workspace                 |
| `npm run db:studio`   | Open Drizzle Studio                     |

## Deploying to Vercel

1. Import the repo into Vercel.
2. Add all env vars from `.env.example` (use the production Neon/Clerk/Resend
   values). Set `NEXT_PUBLIC_APP_URL` to your real domain and
   `INBOUND_EMAIL_DOMAIN` to your inbound domain.
3. In **Resend**, verify your sending domain, configure an **inbound** route to
   `POST https://<your-domain>/api/inbound`, and set `INBOUND_WEBHOOK_SECRET`.
4. In **Clerk**, add your domain to the allowed origins.

## The install snippet

Logged-in owners get two integration modes on the **Install** page:

- **Mode A** — point an existing form's `action` at
  `https://support.yourapp.com/api/tickets/<apiKey>`. On submit the visitor sees
  a tidy confirmation page.
- **Mode B** — a small JS snippet (with the real API key baked in) that
  intercepts the form's submit and POSTs via `fetch`, so the visitor stays on the
  page and sees a success message.

Both are generated dynamically with the workspace's real API key.

---

Built with the design in [`fake-ticket`](https://github.com/JordanGrieve/fake-ticket).
