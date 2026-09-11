# Postbox backend review

**11 September 2026.** A full read of the backend: messages, newsletters,
billing and limits. Every claim below was checked against the code at
`e74d9cd` and the line references are real. Where something is a deliberate
design decision rather than an oversight, it says so — this codebase argues
with itself in comments more than most, and several "gaps" turned out to be
choices with a paragraph of reasoning behind them.

Read §3 first if you only read one part. It answers the question you asked.

---

## 1. What I ran

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 1,380 passed, 88 files, 1 expected fail |
| `npm run build` | clean (CI runs it on every push) |

**The tests prove less than the number suggests.** Not one of them opens a
database connection. Every query is mocked, so 1,380 green tests do not prove
a single piece of SQL is correct — and the backend is mostly SQL. This is the
largest single gap in the project and it has its own phase in §6.

---

## 2. The honest state of each subsystem

### Messages — **live, real email is flowing**

Inbound arrives two ways, both HTTP: a public form key (`POST /api/tickets/:key`)
and a Resend webhook for inbound email (`POST /api/inbound`). There is no MX or
SES receiving path; MX points at Resend.

Outbound replies, notifications, invites and auto-replies all go through
**Resend, and they genuinely send today**. The only gate is `RESEND_API_KEY`
being present and not the placeholder (`lib/email.ts:13-16`).

This is worth stating plainly because `lib/deliver.ts` opens with a long
comment about the default being log-only — that applies to **bulk** mail only.
Two separate mail stacks: Resend for transactional (live), SES for campaigns
(inert). A person reading one file could reasonably conclude nothing sends.

What is good here, and it is a lot: inbound dedupes on `Message-ID`; thread
replies are authorised by a secret token rather than a guessable ticket id;
Svix signature verification is real HMAC with a replay window and a
length-checked `timingSafeEqual`; every field has a length cap; malformed
input degrades to an honest 400 rather than a 500; the honeypot answers with a
byte-identical fake success. Auto-reply guards are thorough — self-address
including plus-tags, role addresses, robot headers, one-ack-per-ticket — and
the rate limits are database-backed and **fail closed**, which is the correct
inverse of the public endpoints.

Tenancy is clean. Every authenticated ticket route takes the workspace from the
session and re-scopes the query; no route accepts a workspace id from the
request. Mutations put the workspace predicate *inside* the statement rather
than checking first, which is the right pattern.

> **Correction, 11 Sep 2026.** An earlier version of this document claimed
> the signup-to-newsletter chain was broken because nothing ever wrote to
> `list_subscribers`. That was wrong. `confirmSubscription` writes one, in
> raw SQL inside a CTE, and the grep behind the claim only looked for the
> Drizzle builder form. The real behaviour: the first confirmed signup in a
> workspace creates a "Newsletter signups" list and every later subscriber
> joins it. A workspace with no subscribers therefore has no list, which is
> what made the composer look like a dead end. Lists have since been removed
> from the send path anyway — see lib/campaign-send.ts — but for a product
> reason, not a broken one.

### Newsletters — **complete, and inert behind three gates**

The pipeline is finished and, from what I can see, carefully built. It cannot
email anybody because of three independent locks, any one of which stops it:

1. `CRON_SECRET` unset → the sweep endpoint refuses every caller, 503.
2. `CAMPAIGN_FROM_ADDRESS` unset → 503, with no fallback to the transactional
   sender.
3. `CAMPAIGN_DELIVERY_MODE` is not exactly `"ses"` → the log deliverer, which
   returns synthetic ids prefixed `not-sent-`.

The SES client is not a stub. It is a hand-rolled SigV4 SESv2 implementation
with raw MIME, per-recipient calls so the unsubscribe token stays 1:1, and
retryable-vs-permanent error classification. It is real code that is simply
unreached.

Several things the older docs list as missing are **done**: consent is enforced,
the postal address is captured and enforced in three places, the bounce webhook
is built with proper SNS signature verification, double opt-in is genuine
(the only `INSERT INTO subscribers` in the repo is behind the confirm POST).
`PROJECT_STATUS.md` §"Remaining work" is stale on all of these.

Recipient claiming is atomic per row — a conditional `UPDATE` that the provider
call only follows if it returned a row — so **a recipient cannot be sent twice**.
The deliberate trade is the opposite failure: a crash between claim and send
loses that one email silently, which `campaign-reconcile.ts` exists to surface.

### Billing — **built, verified, and never enforced except in one place**

Stripe is wired properly. The webhook verifies the signature on the raw body and
fails closed; the plan is derived from the price id rather than trusted from the
payload; an unrecognised price writes the status but deliberately refuses to
touch `plan`; checkout sends only a plan id over the wire and re-resolves the
workspace from the session.

`trialStartedAt` has **no writer in application code at all** — it is the column
default and nothing can reset or extend a trial from inside the product. That is
a nice property and worth keeping.

---

## 3. Limits and pricing — the question you asked

> *"How do we make sure they only send off X amount of letters and messages?"*

**Today: you don't.** Here is the exact state.

### What is enforced

There are precisely **two** places in the entire backend where an entitlement
refuses something:

1. **Campaign send** — `lib/campaign-send.ts:1027-1039`. One check, before any
   row is claimed, which is the correct place. It is the only hard block in the
   product.
2. **Seat limit on invite** — `settings/team/actions.ts:79-89`. Works.

### What is not enforced

- **`ticketsPerMonth` is never counted anywhere.** Its only two uses in the
  codebase are the pricing page and the plan card. A Starter customer sold
  "500 conversations a month" can open an unlimited number.
- **The subscriber cap is never applied.** `limits.subscribers` is used only as
  a boolean — "does this plan include newsletters at all". Nothing refuses the
  1,001st subscriber on a 1,000 plan.
- **Paid plans have no usage check at all.** `lib/billing-query.ts:63-66`
  hardcodes `{tickets: 0, subscribers: 0}` for every non-trial workspace, with
  the reasoning *"an overage is a conversation, not a wall"*. Trials are counted;
  paying customers are not.
- **There is no counter for emails sent.** No table, no column, nothing. This is
  the one that actually costs money.
- **`POST /api/campaigns/[id]/test-send` performs a real send and never reads
  the entitlement.** An expired trial or a lapsed card can still make mail leave
  the building, one message per call.

### The gap that matters most

Your plans are sold on **subscribers**, but your cost is **emails**. A Growth
customer with 1,000 subscribers is within their plan whether they send once a
month or every morning — 1,000 emails or 30,000, same price, same cap. There is
no limit anywhere on the product that corresponds to the thing SES charges for
and the thing that burns sending reputation.

**`emailsPerMonth` does not exist as a concept and I think it needs to.**

### The Clerk question — my recommendation is no

You suggested setting up features in Clerk and gating on them. I read the Clerk
Billing documentation rather than guessing, and I would not do it here. Three
reasons, in order of weight:

**1. The enforcement point has no Clerk session.** The campaign sweep runs from
GitHub Actions against `/api/cron/campaigns` with a bearer secret. There is no
user, no session, and `has()` cannot be called. Same for the SES feedback
webhook and the auto-reply sweep. The one place a send limit has to be
enforceable is the one place Clerk's helper cannot reach. Whatever else you do,
entitlement has to be answerable from the database — and it already is.

**2. Clerk's billing attaches to the wrong entity.** `has({ plan })` evaluates
the active user or organisation. Postbox's tenant is the `workspaces` table;
`agents.clerkUserId` maps a person to a workspace, and a workspace has up to ten
people. A user-level plan would return `true` for the owner and `false` for
everyone else in the same paying workspace. Fixing that properly means migrating
workspaces to Clerk Organizations, which would touch every tenancy check in the
codebase — and tenancy is the area where two previous audits already found real
holes.

**3. You would be running two sources of truth for the same fact.** Stripe is
already wired, signature-verified, price-mapped and tested. Clerk Billing is
also still marked experimental in Clerk's own docs.

**Keep Clerk for identity. Keep Stripe for money. Keep entitlement in Postgres.**
Revisit only if you move tenancy to Clerk Organizations, which is a separate and
much larger decision.

### What I would build instead

Four metrics, three different treatments. The treatments follow the principle
already written into `lib/trial.ts`, which I think is right: **never block a
customer's message; block the account holder's sending.**

| Metric | Treatment | Why |
| --- | --- | --- |
| Seats | Hard block at invite *(already done)* | Correct as is |
| **Emails per month** | **Hard block at send** | Real money, real reputation, and the account holder can fix it |
| Tickets per month | Meter, warn, never block | Blocking drops a customer's enquiry; they have no idea a billing relationship exists |
| Subscribers | Meter, block *sending* over cap, never block signup | A signup is a customer action too |

The mechanism, in five pieces:

1. **`usage_counters` table** — `(workspace_id, metric, period, count)`, unique
   on the triple, incremented by one atomic `INSERT … ON CONFLICT DO UPDATE`.
   This is exactly the pattern `rate_limits` already uses successfully, so it is
   proven in this codebase rather than new.
2. **`lib/usage.ts`** — a pure period key (`2026-09`), `recordUsage`, `readUsage`.
   Pure functions, testable without a database, same shape as the rest of `lib`.
3. **Extend `entitlement()`** to take paid-plan usage and return two new
   blocked reasons, `plan_email_limit` and `plan_subscriber_limit`. The function
   is already pure with `now` passed in, so this is additive and fully testable.
4. **Stop hardcoding zeros** in `getWorkspaceEntitlement` for paid plans.
5. **Budget the batch** in `sendCampaignBatch`: claim
   `min(RECIPIENTS_PER_SWEEP, allowance remaining this month)` rather than a
   fixed 75, and increment the counter as rows are claimed. Because claiming is
   already atomic per row, the counter cannot drift from what was actually sent.

Add `emailsPerMonth` to each plan in `lib/pricing.ts` at the same time.

---

## 4. Findings, ordered by severity

### Serious

**S1 · Email verification is never checked, and email is the credential.**
`lib/viewer.ts:56-64` and `lib/workspace.ts:148-155` read the address with no
`verification.status` test. The address is what claims an invite *and* what
elevates a user to super-admin (`lib/viewer.ts:174`). The fallback is worse than
the primary path: `emailAddresses?.[0]?.emailAddress` takes *any* address on the
account, not the primary one.

Probably not exploitable today — sign-in is Google OAuth only, and Google has
verified the address. But that safety lives in a Clerk dashboard setting that
the code does not assert. Enable email-code sign-up, or let a user add a
secondary address, and this becomes privilege escalation to super-admin.

*Fix: require `verification.status === "verified"`, and never fall back to an
arbitrary address in the list. Half an hour, plus a test that a claim with an
unverified address is refused.*

**S2 · `/api/inbound` has no rate limiting at all.** Every other public write
path has two durable buckets. This one has none, and each accepted request
creates a ticket, sends a workspace notification and may fire an auto-reply.
Anyone holding the shared secret, or replaying a captured request inside the
300-second window, can drive that unbounded.

**S3 · Two secret comparisons are not timing-safe.** The inbound shared secret
(`app/api/inbound/route.ts:69`) and the ticket reply token
(`:136`) are both plain `===`. The same file uses `timingSafeEqual` correctly
elsewhere, so this is inconsistency rather than ignorance. The shared secret is
also accepted from a **query string**, where it lands in access and proxy logs.

**S4 · Test-send bypasses billing.** Covered in §3. One line to fix.

**S5 · Consent has no SQL backstop.** Suppression is enforced three times in
SQL. Consent — the one with GDPR teeth — is enforced only in application code at
materialisation time (`lib/newsletter.ts:537`). A row materialised before that
filter existed, or a subscriber whose `consent_at` is cleared afterwards, will
still be claimed and sent. The file admits this itself.

### Worth fixing before SES goes live

**M1 · No rate limiter in the send path.** Pacing is entirely batch-size times
cadence. Campaign traffic shares a provider quota with ticket replies.

**M2 · Placeholder check is client-side only.** The schedule route validates the
postal address, the list and the queued rows — not unfilled `[brackets]`. A
direct API call can arm a campaign still carrying the starter template's
placeholder text, which ships with brackets in it.

**M3 · `List-Unsubscribe` is not enforced on the SES path.** The headers are
built at both call sites and the *log* deliverer warns when they are missing,
but `createSesDeliverer` never checks. `hasOneClickUnsubscribe()` exists and
nothing on the live path calls it.

**M4 · Stale arithmetic in the one comment an operator would size a send from.**
`lib/campaign-cron.ts:163-174` still describes the five-minute sweep and
"21,600 recipients a day". The real figure at hourly is **1,800**. A 12×
overstatement. The customer-facing copy is safe — it derives from
`SWEEPS_PER_DAY` — only the engineering comment lies.

**M5 · Nothing detects a dead sweep.** GitHub Actions schedules are best-effort
and auto-disable after 60 days without a commit. `campaign-health` can report
"not configured" but cannot report "no tick for three days".

**M6 · Stripe has no event dedupe and ignores invoice events.** Replays converge
because every write is a full overwrite — but **out-of-order delivery does not
converge**: an older `customer.subscription.updated` arriving late writes stale
plan and period data back over newer state. `invoice.payment_failed` and
`invoice.paid` are not handled. A subscription created in the Stripe dashboard
rather than through checkout has no `metadata.workspaceId` and is silently
dropped — the customer pays and gets nothing.

**M7 · `noteProviderFeedback` has no tenancy predicate.**
`lib/suppressions.ts:433-439` is `UPDATE campaign_recipients SET error = … WHERE
provider_message_id = …` with no workspace join and no `LIMIT`, in a file where
every other statement is carefully scoped.

### Lower, but real

- **L1** — Invites have no token and no expiry. A typo hands a stranger a
  client's customer mail, permanently.
- **L2** — No Clerk webhook exists at all, so a deleted Clerk user leaves a live
  agent row and an email change never syncs.
- **L3** — The impersonation hash chain is only verified when a human opens the
  admin access-log page. Nothing scheduled checks it, and it does not cover
  session *exit* — `endedAt` and `endedReason` are outside the chain, so a
  recorded session can be silently lengthened or relabelled.
- **L4** — An impersonating operator inherits the tenant's Stripe portal
  (invoices, card last four, billing address). No separate guard on those routes.
- **L5** — `messageIdExists` is global rather than workspace-scoped, so a sender
  can suppress ingestion into workspace B by getting the same `Message-ID` in
  anywhere first.
- **L6** — `NEXT_PUBLIC_APP_URL` defaults silently to `https://postbox.help`,
  which on a preview deployment sends paying customers to the wrong domain after
  checkout with only a console line to say so.
- **L7** — Auto-reply delays of 5 minutes and 1 hour are in the type but nothing
  schedules them; the immediate path sends straight away. (The UI now hides
  them, so this is latent rather than visible.)
- **L8** — An all-failed campaign is still marked `sent` in `campaigns.status`.
  Surfaced honestly in the UI, wrong in the column.

---

## 5. What is genuinely good

Worth writing down so none of it gets "tidied" away later:

- **Claim-before-send with a conditional UPDATE.** The reasoning — that losing
  one email is better than sending one twice — is correct and rare.
- **The inbound/sending split in `lib/trial.ts`.** Never punish the customer for
  the account holder's invoice. Build the new limits on top of this, not around it.
- **Fail-closed everywhere it counts**: cron auth, SNS topic ARN, subscribe
  token secret, Stripe webhook secret, auto-reply rate limits.
- **Consent evidence taken from `Origin`/`Referer`, never from a body field**,
  and left null when unknown rather than invented.
- **The double opt-in shape**: the confirm link is a GET to a page and the write
  is a POST from a button, so a mail scanner cannot consent on someone's behalf.
- **`db/guard.ts`** refusing production writes from a developer machine.
- **Plan derived from the Stripe price id**, never trusted from the payload.

---

## 6. The plan

Five phases. Each is independently shippable and each ends green.

### Phase 0 — Security (about a day)

Do this first regardless of everything else. All five are small.

1. S1 — require a verified email; drop the arbitrary-address fallback.
2. S2 — two durable rate-limit buckets on `/api/inbound`, matching the form route.
3. S3 — `timingSafeEqual` for both comparisons; retire the query-string secret
   once the Resend webhook is repointed to the header.
4. S4 — entitlement check in the test-send route.
5. S5 — add the consent predicate to the materialising INSERT and the claim
   UPDATE, so it has the same three backstops suppression has.

**Also, off-code:** the secret rotation in `HUMAN_ACTIONS.md` is still open and
is the oldest unresolved item in the project. Clerk `sk_live`, the Neon
password and the Resend key all passed through chat transcripts. Nothing in the
repo can tell whether it has been done, which is why every audit keeps
re-reporting it. Do it, then tick it there.

### Phase 1 — Limits (two to three days)

The thing you asked for. Order matters: the counter has to exist before
anything can read it.

1. **Decide the numbers.** `lib/pricing.ts` says at the top that the prices are
   a proposal you have not signed off. Everything downstream is blocked on this
   and it is a ten-minute decision you have been carrying for three weeks.
   Add an `emailsPerMonth` figure per plan while you are there.
2. `usage_counters` table + migration.
3. `lib/usage.ts` with pure period logic and full tests.
4. Extend `entitlement()` with the two new blocked reasons; extend
   `describeBlock()` to word them for the account holder.
5. Count real usage in `getWorkspaceEntitlement` for paid plans.
6. Budget the batch in `sendCampaignBatch`; increment as rows are claimed.
7. Meter tickets at ingestion — **count only, never refuse**.
8. Surface it: a usage row on Settings → Billing, and a column in the admin
   console. A limit nobody can see is a support ticket waiting to happen.

Every guard gets broken deliberately to prove it fails, per `AGENTS.md`.

### Phase 2 — Before `CAMPAIGN_DELIVERY_MODE=ses` (one to two days)

Do not flip the mode until all of these are done.

1. M1 — send-path rate limiter, per workspace and global.
2. M2 — placeholder validation in the schedule route.
3. M3 — `List-Unsubscribe` assertion inside `createSesDeliverer`.
4. M4 — fix the arithmetic comment.
5. M5 — sweep liveness: record the last successful tick, surface it in health,
   alert when it goes stale.
6. M7 — tenancy predicate on `noteProviderFeedback`.

The external blocker is unchanged and is not code: **SES is still in the
eu-west-1 sandbox** and the production-access case is open. `docs/SES-PRODUCTION-ACCESS.md`
§3 has the text. That single reply is the difference between a product that
demonstrates and a product that ships.

### Phase 3 — Billing robustness (one day)

1. M6a — a `stripe_events` table keyed on `event.id`; ignore anything already
   seen, and ignore an event older than what the row currently reflects.
2. M6b — handle `invoice.payment_failed` and `invoice.paid`.
3. M6c — an orphan-subscription path: if `metadata.workspaceId` is missing, do
   not drop it silently — record it somewhere an operator will see.
4. L4 — refuse checkout and portal while impersonating.

### Phase 4 — Test the SQL (two to three days, highest long-term value)

1,380 tests and none of them run a query. Every claim in this review about what
the SQL does came from reading it.

1. Postgres in a CI service container; run migrations against it.
2. Integration tests for the paths where correctness *is* the SQL:
   - a recipient cannot be claimed twice under concurrency
   - suppression blocks at all three points
   - consent blocks after the Phase 0 fix
   - the usage counter is atomic under parallel increments
   - tenancy: a query scoped to workspace A never returns a row from B
3. Keep them in a separate vitest project so the fast unit suite stays fast.

### Phase 5 — Later

L1 invite tokens and expiry · L2 a Clerk webhook for `user.deleted` and
`email.updated` · L3 scheduled chain verification and chaining the session exit ·
L5 workspace-scoped message-id dedupe · L8 an honest terminal status for an
all-failed campaign.

---

## 7. If you only do three things

1. **Phase 0.** It is a day, and S1 is a path to super-admin that depends on a
   dashboard setting the code does not assert.
2. **Sign off the prices, then Phase 1.** Nothing about limits can be built
   until the numbers exist, and you are currently selling caps that nothing
   enforces.
3. **Phase 4.** The next serious bug in this product will be in a query, and
   right now nothing would catch it.
