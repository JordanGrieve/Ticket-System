# Human actions — Postbox

**Date:** 3 August 2026, revised 22 August 2026 · Things only Jordan can do.
Claude handles everything code-side. Ordered by leverage within each group.
Tick as you go.

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
- [x] ~~**Sentry error monitoring**~~ — **done and verified in production
  3 Aug.** Browser errors confirmed (real event, `environment=production`).
  Server-side confirmed after `226f90c` (server/edge now fall back to
  `NEXT_PUBLIC_SENTRY_DSN`, so one variable is enough — the missing `SENTRY_DSN`
  was why the server stayed dark). `SENTRY_AUTH_TOKEN` is set, so stack traces
  upload source maps. Nothing further needed from you.
  - Only remaining Sentry nicety: tick **Preview** on the Sentry env vars when
    you set up staging, or preview deploys will report nothing.
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

## 1b · Newsletter pipeline — added 22 August 2026

Commit `7900a5c` shipped a worker, a nightly cron and an SES integration. The
switches below are yours; the code side is mine. **Do not set
`CAMPAIGN_DELIVERY_MODE` yet** — see the last item.

- [ ] **Set `CRON_SECRET` in Vercel (Production), or accept that the cron does
  nothing** — `vercel.json` schedules `/api/cron/campaigns` nightly at 03:00,
  and the route refuses **every** caller, Vercel's own scheduler included, while
  this is unset. It returns 503 by design: an unauthenticated version of that URL
  is a public "send everyone's marketing email now" button. So production is
  currently running a nightly job that 503s. That is harmless today — nothing is
  queued to send — but it is noise in the log and it will be a confusing
  first symptom later. Any long random string. **2 min.** (Then redeploy; env
  edits do nothing until the next deploy.)
- [ ] **Confirm the SES sending identity actually exists** — I was told
  `news.postbox.help` is verified in `eu-west-1`, and `.env.example` agrees on
  the region, but I have no AWS credentials here and could not check. Run
  `aws sesv2 get-email-identity --email-identity news.postbox.help --region eu-west-1`,
  or look in the SES console. Also worth confirming: whether the account is
  still in the SES **sandbox**, which caps you to verified recipients and 200
  messages/day and is easy to forget about until the first real send.
- [ ] **Look at the new Schedule control before it ships** — until 22 Aug
  nothing in the product could move a campaign out of `draft`, which meant the
  whole send pipeline was unreachable. A `POST|DELETE /api/campaigns/[id]/schedule`
  route and a Schedule button in the composer closed that during the same
  session this file was revised; the work is in the working tree, not yet on
  `main`. It writes a status and a timestamp and sends nothing — delivery is
  still log-only — but it is the first control in the product whose name implies
  mail, so it is worth your eyes on the wording and on what happens after you
  press it.
- [ ] **Do NOT flip `CAMPAIGN_DELIVERY_MODE=ses` yet** — this is the one switch
  in the codebase that cannot be undone, because its failure mode is mail that
  has already left. Blocking on my side, not yours: there is no consent check
  (`selectAudience` never reads `consentAt`, so an import with no provenance is
  mailable), no postal address in the schema for the CAN-SPAM footer, and no
  bounce/complaint webhook, so a hard bounce gets re-mailed every campaign.
  `docs/NEWSLETTER.md` §0 is the ordered list. I will tell you when it is safe.

## 2 · Do soon (nothing stuck yet, but needed)

- [ ] **Clerk MFA — deferred on cost (revisit when clients grow)** — TOTP is off
  at the instance level and turning it on needs Clerk's paid Enhanced
  Authentication add-on. Deliberately parked 3 Aug; Google-account 2FA (§1) is
  the free stand-in and covers the sign-in path, since Google OAuth is the only
  way in. Revisit when you take paying clients or add non-Google logins — at
  that point client accounts, not just yours, will want a second factor.
  (Asana: 🚧 Enable 2FA)
- [x] ~~**Privacy policy: add Sentry as a sub-processor**~~ — **done.** `/privacy`
  lists Sentry alongside Neon, Clerk, Resend, Vercel and Cloudflare, and carries
  a dedicated "Error monitoring" section stating what Sentry can receive (stack
  traces, failing URLs, coarse IP-derived location) and what is switched off
  (request bodies, headers, user identity, local variables, Session Replay).
  Nothing outstanding.
- [ ] **Privacy policy: AWS SES added as a sub-processor 22 Aug — read it** —
  I have added it, because SES is now the configured marketing-email provider
  and leaving it off the list while the integration exists would be the wrong
  way round. The wording says SES receives recipient addresses and full message
  content for marketing sends, processes in AWS Europe (Ireland), and does not
  carry ticket replies. **Two things need your eye:** confirm that matches what
  you actually set up, and note that adding a sub-processor is normally
  something you notify clients about rather than change silently.
- [ ] **Set up staging** — 10 minutes of dashboard clicks, documented
  click-by-click in `DEPLOYMENT.md`: Neon branch DB + Vercel Preview-scoped
  `DATABASE_URL` + dev-instance Clerk keys for previews. After this, risky
  changes stop deploying straight to your live client.
- [ ] **Upgrade Vercel to Pro (~$20/mo)** — the Hobby plan's terms prohibit
  commercial use, and Postbox now has a real business client on it. Also lifts
  build/function limits. **How:** Vercel → Settings → Billing → Pro.
  *Third reason as of 22 Aug: Hobby caps cron at once a day, which is why the
  campaign sweep runs nightly. At 75 recipients per campaign per tick, a
  1,000-person newsletter would take a fortnight to go out. Pro allows a
  per-minute schedule and a 300s function, which is roughly a 400× improvement
  on that. Not urgent while nothing can send, but it becomes the throughput
  ceiling the day something can.*
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
