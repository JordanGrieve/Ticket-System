# Human actions — Postbox

**Date:** 1 August 2026 · Things only Jordan can do. Claude handles everything code-side.
Ordered by leverage within each group. Tick as you go.

## 1 · Do now (quick, high leverage)

- [ ] **Enable 2FA on your admin account** — *the* security gap: this account can
  read every client's data. **How:** sign in at postbox.help → account menu →
  Manage account → Security → add an authenticator app (Google Authenticator /
  1Password). **2 min.** (Asana: 🚧 Enable 2FA)
- [ ] **Eyeball the freshly deployed pages** — the landing page (`postbox.help`
  signed out), `/terms`, `/privacy`, `/contacts`, and the new pagination controls
  went live with today's push; I can verify content but not styled rendering
  behind login. Report anything that looks off and it gets fixed same-day.
  **5 min.**
- [ ] **Confirm CI's first run went green** — github.com/JordanGrieve/Ticket-System
  → Actions tab → the "CI" run on today's push should be ✅. If red, paste the
  failing lines in chat. **1 min.**
- [ ] **Fix the DMARC report address** — it still reports to GoDaddy's parking
  service. **How:** Cloudflare → postbox.help → DNS → edit the `_dmarc` TXT
  record → change `rua=mailto:dmarc_rua@onsecureserver.net` to
  `rua=mailto:` + your own email. **1 min.** (helps email deliverability insight)
- [ ] **Get a Sentry DSN** — unblocks error monitoring (code side is ~30 min once
  you have it). **How:** sentry.io → sign up (free tier) → Create project →
  Next.js → copy the DSN → add to Vercel env as `SENTRY_DSN` (Production ticked)
  — don't paste it in chat, just say "Sentry DSN is in Vercel". **10 min.**
  (Asana: Error monitoring)
- [ ] **Delete the orphan Clerk user** — leftover test signup with production
  access to nothing (lands on /no-access) — still, tidy it. **How:**
  dashboard.clerk.com → Production instance → Users → the account that isn't
  you or your client → ⋯ → Delete. **1 min.** (Asana: 🚧 orphan user)
- [ ] **Rotate the three exposed secrets** — Clerk `sk_live`, Neon DB password,
  Resend API key all passed through AI chat transcripts during setup. **How:**
  regenerate each in its dashboard (Clerk → API keys; Neon → Roles → reset
  password; Resend → API keys), then update the value in BOTH Vercel env vars
  (then Redeploy) and `.env.local` (edit the file directly — including the
  `CLERK_SECRET_KEY_PROD` line). Do at a calm moment; brief blips possible.
  **15 min.** (Asana: 🚧 Rotate secrets)

## 2 · Do soon (nothing stuck yet, but needed)

- [ ] **Set up staging** — 10 minutes of dashboard clicks, documented
  click-by-click in `DEPLOYMENT.md`: Neon branch DB + Vercel Preview-scoped
  `DATABASE_URL` + dev-instance Clerk keys for previews. After this, risky
  changes stop deploying straight to your live client.
- [ ] **Upgrade Vercel to Pro (~$20/mo)** — the Hobby plan's terms prohibit
  commercial use, and Postbox now has a real business client on it. Also lifts
  build/function limits. **How:** Vercel → Settings → Billing → Pro.
- [ ] **Check provider limits & domain renewal** — (a) Resend free tier is
  100 emails/day / 3k/month — fine for the pilot, will need the $20/mo tier as
  clients grow (watch usage at resend.com/metrics); (b) postbox.help was $1.99
  for year one — `.help` renews at ~$20–30, check auto-renew + card at your
  registrar so the domain never lapses (everything dies with it).
- [ ] **Have the Terms/Privacy drafts reviewed** — they're honest and tailored,
  but written by an AI, not a lawyer. Before serious scale, get a professional
  (or at least a careful human) read. (Asana: legal task comment)
- [ ] **Ask your pilot client for structured feedback** — 3 questions: what's
  confusing, what's missing, would they pay? Only you can have that
  conversation; it steers the whole roadmap.

## 3 · Decisions needed (options + recommendation)

- [ ] **Pricing/monetization** — Options: (a) keep pilot free, decide after 2–3
  clients; (b) flat per-workspace fee now (£10–20/mo, Stripe); (c) usage-based.
  **Recommendation: (a)** — you need usage data and testimonials more than
  £15/mo right now. When decided, Stripe integration becomes a normal code task.
- [ ] **Backups** — Neon free tier has limited point-in-time recovery. Options:
  (a) Neon paid plan (real PITR, ~$19/mo); (b) nightly `pg_dump` via GitHub
  Actions to private storage (needs a storage target + credentials from you);
  (c) accept the risk during pilot. **Recommendation: (b)** — cheap and
  sufficient; give me an R2/S3 bucket + keys (in Vercel/GitHub secrets, not
  chat) and I'll build it.
- [ ] **Mobile layout direction** — the responsive redesign needs your eyes on a
  live browser at phone widths (drawer sidebar vs top bar). **Recommendation:**
  a 30-minute session together where I change, you look.
- [ ] **Product name check** — "Postbox" is an existing email client
  (postbox-inc). Zero issue at pilot scale; decide whether to rebrand BEFORE
  spending on marketing/SEO. **Recommendation:** park until after the pilot,
  then decide once.

## 4 · Waiting on others

- [ ] **Pilot client's real-world usage** — tickets flowing, replies threading in
  their customers' varied mail clients. Nothing to do but watch and gently
  chase the feedback conversation above. (Asana: 🔄 Pilot period)
