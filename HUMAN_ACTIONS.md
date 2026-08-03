# Human actions — Postbox

**Date:** 3 August 2026 · Things only Jordan can do. Claude handles everything code-side.
Ordered by leverage within each group. Tick as you go.

## 1 · Do now (quick, high leverage)

- [ ] **Turn on 2FA for your Google account** — this is the free substitute for
  Clerk MFA, and it closes most of the gap. You sign into Postbox **only** via
  Google OAuth, so Google's second factor gates the sign-in before Clerk is ever
  reached. Clerk's own MFA is a paid add-on (deferred — see §2), but this isn't.
  **How:** myaccount.google.com → Security → 2-Step Verification. **2 min.**
- [ ] **Enable 2FA on your Clerk *dashboard* account** — different account, and
  free: it administers the whole Clerk instance, so it's the bigger blast radius
  of the two. dashboard.clerk.com → avatar → Account → Security → two-step
  verification. **2 min.**
- [ ] **Sentry: check the DSN you pasted into Vercel ends `/4511847016235088`**
  — that is the live `postbox` project's ID, read straight from Sentry. An
  earlier screenshot showed `4511847062306896`, which is *not* the current
  project; if that's what landed in Vercel, production will report into nothing.
  Both `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` should hold the same value and
  end in the same ID. **2 min.** Local `.env.local` is already correct.
- [ ] **Sentry: `SENTRY_AUTH_TOKEN` (optional, for readable stack traces)** —
  sentry.io → Settings → Developer Settings → **Auth Tokens** → Create New
  Token (scopes `project:releases`, `org:read`) → Vercel env, **Sensitive ON**,
  Production + Preview. Without it errors still arrive; the frames just show
  minified names. **5 min.** (Asana: Error monitoring)
- [x] ~~**Eyeball the freshly deployed pages**~~ — done 3 Aug: Jordan confirmed
  `/terms`, `/privacy`, `/inbox` and `/contacts` all look right; landing page,
  `/terms` and `/privacy` also verified live over HTTP.
- [x] ~~**Confirm CI's first run went green**~~ — done: both CI runs on the
  2 Aug pushes passed (39s each). Nothing for you here.
- [x] ~~**Fix the DMARC report address**~~ — done 3 Aug: `rua` now points at
  jordangrieve.dev@gmail.com, verified live via Google's resolver. Note: Gmail
  is an external destination, so strict reporters may skip you; if coverage
  matters later, move `rua` to a free DMARC digest service.
- [ ] **Decide on the Sentry plan** — you're on a 14-day trial of a paid tier.
  The **free** Developer plan (5k errors/month) is plenty for a one-client
  pilot; you can let the trial lapse rather than upgrading. Nothing in the code
  depends on the paid features.
- [x] ~~**Delete the orphan Clerk user**~~ — done 3 Aug by Jordan.
- [ ] **Rotate the three exposed secrets** — Clerk `sk_live`, Neon DB password,
  Resend API key all passed through AI chat transcripts during setup. **How:**
  regenerate each in its dashboard (Clerk → API keys; Neon → Roles → reset
  password; Resend → API keys), then update the value in BOTH Vercel env vars
  (then Redeploy) and `.env.local` (edit the file directly — including the
  `CLERK_SECRET_KEY_PROD` line). Do at a calm moment; brief blips possible.
  **15 min.** (Asana: 🚧 Rotate secrets)

## 2 · Do soon (nothing stuck yet, but needed)

- [ ] **Clerk MFA — deferred on cost (revisit when clients grow)** — TOTP is off
  at the instance level and turning it on needs Clerk's paid Enhanced
  Authentication add-on. Deliberately parked 3 Aug; Google-account 2FA (§1) is
  the free stand-in and covers the sign-in path, since Google OAuth is the only
  way in. Revisit when you take paying clients or add non-Google logins — at
  that point client accounts, not just yours, will want a second factor.
  (Asana: 🚧 Enable 2FA)
- [ ] **Privacy policy: add Sentry as a sub-processor** — Sentry is now a third
  party that can receive fragments of your clients' data in error reports. The
  SDK is configured conservatively (no request bodies, headers, user info or
  local variables — see [sentry.server.config.ts](sentry.server.config.ts)), but
  stack traces and URLs can still incidentally carry identifiers. `/privacy`
  lists sub-processors; Sentry should join Neon, Clerk, Resend and Vercel there.
  Say the word and I'll draft the edit.
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
