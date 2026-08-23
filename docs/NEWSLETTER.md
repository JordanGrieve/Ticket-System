# Newsletter / campaigns

How bulk marketing mail is meant to work in Postbox, what is built, and the
specific reasons none of it can send yet.

Read `db/schema.ts` first — the doc comments on `subscribers`, `suppressions`,
`campaigns` and `campaign_recipients` encode decisions this document only
elaborates on.

> **Status (22 August 2026, late): the pipeline is complete, reachable and
> lawful, and still cannot email a real person.** Commit `7900a5c` added the
> worker (`app/api/cron/campaigns/route.ts`) and the delivery abstraction
> (`lib/deliver.ts`, `lib/deliver-ses.ts`). What holds it shut is now
> configuration and an Amazon review, not missing code.
>
> **Corrections to earlier versions of this file, which are still wrong in
> places further down — trust this block over the sections below:**
>
> - The schedule is **not** `vercel.json` `crons`. It is
>   `.github/workflows/campaign-sweep.yml`, every 5 minutes, best-effort.
>   `vercel.json` has no `crons` key. Any arithmetic in this document based on
>   "one sweep a day" or "75 recipients per night" describes deleted
>   infrastructure.
> - Marketing consent **is** enforced. `selectAudience` reads `consentAt` and
>   buckets `no_consent`; the composer shows the count.
> - The CAN-SPAM postal address **is** captured (Settings → Sender identity)
>   and enforced. `renderCampaign` throws without one, `sendCampaignBatch`
>   refuses the batch before claiming a row, and the schedule route refuses to
>   arm the campaign at all.
> - The bounce/complaint webhook **is** built:
>   `app/api/webhooks/ses/route.ts` + `lib/ses-events.ts`, SNS signature
>   verified and topic-ARN pinned. It returns 503 until `SES_SNS_TOPIC_ARN` is
>   set. The AWS side (topic, access policy, configuration-set event
>   destination) is created.
> - Newsletter signup with double opt-in **is** built and verified end to end
>   in production, including consent evidence (method, timestamp, page URL,
>   IP).
>
> **What actually remains:** SES is in the eu-west-1 **sandbox**; and
> `CRON_SECRET`, `CAMPAIGN_FROM_ADDRESS`, `SES_SNS_TOPIC_ARN` and AWS
> credentials are unset in Vercel. See `docs/SES-PRODUCTION-ACCESS.md`.
>
> ⚠️ Do not flip `CAMPAIGN_DELIVERY_MODE=ses` to "see if it works". Open Door
> Bakery has one confirmed subscriber; in the sandbox that send is rejected,
> the row is written `failed`, the campaign is marked `sent`, and nothing in
> the product can re-queue it. Use **Send a test to myself** in the composer.

---

## 0. What actually blocks a send today

Ordered: the first item is the one that stops a campaign before any of the
others get a chance to. Verified against the code on **22 August 2026**; this is
the section most likely to drift, so check it before trusting it.

1. ~~**Nothing in the product can move a campaign out of `draft`.**~~ **Closed
   while this section was being written — read the caveat.** For the whole of
   `7900a5c` this was the binding constraint and no document mentioned it: the
   sweep only picks up campaigns in `sending`; the only promotion path,
   `promoteDueScheduledCampaigns()`, requires `status = 'scheduled'` and a past
   `scheduled_at`; and nothing wrote either, so the index
   `campaigns_scheduled_idx` had never matched a row and everything behind it
   was dead code. `POST|DELETE /api/campaigns/[id]/schedule` plus
   `lib/campaign-schedule.ts` now supply that transition, with a Schedule
   control in the composer. "Send now" is the same code path with the timestamp
   resolved to `now`, deliberately, so there is no second branch that could skip
   a precondition; and arming a campaign still requires a list and at least one
   `queued` recipient row.
   **Caveat: as of 22 August 2026 that work is uncommitted in the working tree,
   not on `main`.** If you are reading this from a checkout of `main` at
   `7900a5c` or earlier, the original blocker is still real and this item is the
   one to act on. Verify with
   `git log --oneline -- app/api/campaigns/\[id\]/schedule`.
   Note also what it does *not* do: it writes two columns. The mail is still
   gated on items 2–4 below, so a campaign armed today marches to `sent` writing
   log lines and transmitting nothing.
2. **`CRON_SECRET` gates the route, fails closed, and was undocumented.**
   `authorizeCronRequest` returns 503 to every caller — Vercel's own scheduler
   included — while the variable is unset. Until this document was corrected the
   variable appeared in no deployment doc at all, so a production cron has been
   firing nightly against a route that refuses it. Whether it is set in Vercel
   today could not be verified from the repository; check
   Vercel → Settings → Environment Variables.
3. **`CAMPAIGN_FROM_ADDRESS` gates it again, one step later.**
   `envelopeFromEnv` runs before the deliverer is constructed and 503s when it
   is unset. There is deliberately no fallback to `replies@postbox.help`: that
   is the transactional sender on the primary domain, and §1.3 is the argument
   for why marketing must not touch it.
4. **`CAMPAIGN_DELIVERY_MODE` is not `ses`, so the deliverer is the log
   deliverer.** Exact-match, case-sensitive, after trimming. It writes a record
   of what would have gone out, mints a synthetic message id so the
   claim-before-send loop is exercised honestly, and contacts nothing. This is
   the last gate, and the only one whose release is irreversible.
5. **No consent enforcement — the item with legal teeth.** `selectAudience`
   takes candidates and a suppression set and nothing else; `consentAt` is read
   nowhere in `lib/` outside a comment. See §7, which explains why the omission
   is deliberate rather than forgotten. Nothing above this line should be
   released before it is closed.
6. **No postal address to put in the footer.** CAN-SPAM requires one in every
   message. `workspaces` has `name`, `apiKey`, `inboundEmail`, `sendingEmail`,
   `accent`, `createdAt` — no `legalName`, no `postalAddress`. The renderer
   cannot emit what the schema cannot store.
7. **No bounce/complaint webhook.** §6. `campaign_recipients` has the columns
   and the `provider_message_id` index to receive one, and `lib/suppressions.ts`
   can write the suppression; the receiving route does not exist, so a hard
   bounce is re-mailed next campaign.
8. **No cross-invocation rate limiter.** `lib/rate-limit.ts` is still an
   in-memory fixed-window Map, correct only within a single instance. Two
   overlapping sweeps each permit the full rate.
9. **The schedule is nightly, and the batch arithmetic assumes per-minute.**
   `vercel.json` sets `0 3 * * *`. `RECIPIENTS_PER_SWEEP` is 75 and the comment
   deriving it reasons in terms of "75/minute is 4,500/hour". At one tick a day
   the real ceiling is 75 recipients per campaign per day, so a 1,000-recipient
   campaign takes a fortnight and a 40,000-recipient one takes over a year, not
   the nine hours the comment quotes. A daily cron is what the Hobby plan
   allows; sub-daily needs Pro (`NEWSLETTER-BUILDER-PLAN.md` §5.8). **RESOLVED,
   and not by upgrading the plan.** The sweep was moved off Vercel Cron onto
   `.github/workflows/campaign-sweep.yml`, which GitHub schedules every five
   minutes for free; the `crons` entry was removed from `vercel.json` so only
   one thing drives it. `SWEEPS_PER_DAY` is now 288 and every on-screen
   estimate divides by it. The remaining caveat is honesty about the cadence,
   not the cadence itself: Actions schedules are best effort — delayed under
   runner load, dropped with no backfill, and auto-disabled after 60 days
   without a commit — so 288 is a ceiling and the estimates read as floors.
10. **No verified marketing sending domain in the repo's own record.** A
    verified SES identity for `news.postbox.help` in `eu-west-1` is reported to
    exist and `.env.example` corroborates the region and configuration-set name,
    but nothing in this repository proves it and it could not be checked from
    here (no AWS credentials). Treat as unconfirmed until someone runs
    `aws sesv2 get-email-identity --email-identity news.postbox.help`.
11. **No reconciliation sweep** for rows at `sent` with no
    `provider_message_id` — the documented residue of claim-before-send (§4).

Items 2–4 are switches. Items 5–11 are work. Item 1 was work and has just been
done, which is why it reads differently from the rest.

**The load-bearing sentence, if you read nothing else:** items 2, 3 and 4 are
three independent environment gates, and all three must be opened deliberately
before a single real message leaves. Items 5 and 6 are the ones that make
opening them lawful, and neither is built.

---

## 1. The provider question

The product sends transactional mail (ticket replies, notifications,
auto-replies) through **Resend**, from `replies@postbox.help`. The question was
whether Resend should also carry bulk marketing.

**Answer: no — not in the same Resend team, and the reason is not the one we
expected.**

All findings below were checked against current vendor documentation on
**2026-08-17**. Where a claim could not be verified from a primary source it is
marked ⚠️.

### 1.1 What Resend actually offers

| Capability | Finding | Source |
|---|---|---|
| Broadcasts (bulk marketing) | Exists. Resend handles "queuing, throttling, and scheduling" server-side. Recipients selected via **segments** within an Audience. Has a topics feature for category-level opt-outs. | [resend.com/docs/dashboard/broadcasts/introduction](https://resend.com/docs/dashboard/broadcasts/introduction.md) |
| Audiences (contact store) | Exists. Contacts, properties, segments, topics. CSV import to 200MB. Contacts carry an `unsubscribed` boolean. | [resend.com/docs/dashboard/audiences/introduction](https://resend.com/docs/dashboard/audiences/introduction.md) |
| Send-broadcast API | `POST /broadcasts/{id}/send`, optional `scheduled_at`. **A broadcast can only be sent by API if it was created by API.** | [api-reference/broadcasts/send-broadcast](https://resend.com/docs/api-reference/broadcasts/send-broadcast.md) |
| Batch send | `POST /emails/batch`, **max 100 emails per call**. No attachments in batch. | [api-reference/emails/send-batch-emails](https://resend.com/docs/api-reference/emails/send-batch-emails) |
| Single send | Max **50 recipients** per `to`. Supports custom `headers` and an `Idempotency-Key`. | [api-reference/emails/send-email](https://resend.com/docs/api-reference/emails/send-email.md) |
| Rate limit | **10 requests/second per team, shared across every API key.** Increasable on request. 429 with `ratelimit-*` / `retry-after` headers. | [api-reference/rate-limit](https://resend.com/docs/api-reference/rate-limit.md) |
| Quotas | Daily cap on free plan only (100/day). Paid plans are monthly-quota based; overage capped at **5× plan quota**. | [knowledge-base/account-quotas-and-limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits) |
| Health thresholds | Resend's own: bounce rate **< 4%**, spam rate **< 0.08%** — stricter than Gmail's 0.10% guidance. | same |
| Webhooks | 19 event types including `email.sent/delivered/bounced/complained/failed`, `suppression.added/removed`. Delivered via Svix; `svix-id` header is unique per delivery and is the dedupe key. Payload carries `email_id` and `message_id`. | [webhooks/event-types](https://resend.com/docs/dashboard/webhooks/event-types.md), [webhooks/introduction](https://resend.com/docs/dashboard/webhooks/introduction.md) |
| Campaign-level events | **None.** There are no `broadcast.*` events. "Is this campaign finished?" has to be reconciled from per-message events. | same |

**Pricing** ([resend.com/pricing](https://resend.com/pricing), fetched
2026-08-17). Transactional is metered by **emails**, marketing by **contacts** —
two separate bills:

- Transactional: Free $0 / 3,000 · Pro **$20 / 50k** · Pro **$35 / 100k** ·
  Scale **$90 / 100k** · **$160 / 200k** · **$350 / 500k** · **$650 / 1M** ·
  $1,150 / 2.5M. Overage $0.90 → $0.46 per 1,000 as volume rises.
- Marketing: Free 1,000 contacts · **$40 / 5k** · $80 / 10k · $180 / 25k ·
  **$250 / 50k** · $450 / 100k · $650 / 150k.
- Dedicated IP **$30/mo, Scale plan only, requires 3,000+ emails/day**.
- Data retention is **30 days** on Free/Pro/Scale — long-term campaign
  reporting has to live in our own tables regardless of provider.

Note the marketing meter is **per contact, not per send**. A dormant 50k-address
tenant list costs $250/mo whether we mail it monthly or never.

### 1.2 The blocking finding: Resend suppressions are team-wide

Resend's own documentation, verbatim:

> "Suppressions apply to your entire team. Any address added to the suppression
> list will be skipped across all your domains and subdomains when sending
> transactional or Broadcast emails."
> — [dashboard/emails/email-suppressions](https://resend.com/docs/dashboard/emails/email-suppressions.md)

Read that against what Postbox is. Suppression is **not** per-domain, **not**
per-audience, **not** per-tenant. So:

- Tenant A's newsletter goes to `sam@example.com`. Sam hits "spam".
- Sam is now suppressed **account-wide**.
- Sam is also a support customer of Tenant B. Their ticket replies from
  `replies@postbox.help` are now silently dropped.

That is a transactional-mail outage for an uninvolved tenant, caused by a
marketing complaint, with no error surfaced to anyone. It is the worst failure
this product can have, and no amount of subdomain hygiene touches it, because
the documentation says explicitly that it crosses domains *and* subdomains.

**This, not domain reputation, is the reason bulk must not share the Resend team
with transactional.**

### 1.3 Testing the reputation-contamination claim

The claim under test:

> Sending bulk marketing from the same domain as transactional support replies
> risks reputation contamination, because one tenant's spam complaints degrade
> inbox placement for every other tenant's support mail.

**Verdict: true in direction, imprecise in mechanism, and the obvious fix is
weaker than it is usually sold as.**

What the primary sources actually say:

- Google tracks reputation at the **exact authenticating domain** — the
  Postmaster Tools Domain Reputation and Spam Rate dashboards key on the DKIM
  `d=` domain / SPF return-path domain, and subdomains can be registered
  independently.
  ([support.google.com/a/answer/14668346](https://support.google.com/a/answer/14668346),
  [support.google.com/mail/answer/9981691](https://support.google.com/mail/answer/9981691))
  → *a subdomain does get its own score.*
- **But the Compliance dashboard covers primary domains only, and subdomain
  data informs the primary domain's compliance rating.** (same source)
  → *separation is one-way-ish, not a firewall.*
- **The 5,000-messages/day bulk-sender threshold aggregates across subdomains.**
  Google's own worked example: 2,500 from `solarmora.com` + 2,500 from
  `promotions.solarmora.com` = 5,000, triggering bulk status. And "bulk sender
  status doesn't have an expiration date."
  ([support.google.com/a/answer/14229414](https://support.google.com/a/answer/14229414))
  → *`news.postbox.help` does not keep `postbox.help` under the bar, and once
  crossed, our transactional mail inherits bulk-sender obligations permanently.*
- Gmail bulk requirements: SPF **and** DKIM (both), DMARC present (`p=none` is
  acceptable), one-click unsubscribe, spam rate **below 0.10%** and never at or
  above **0.30%**, calculated daily.
  ([support.google.com/a/answer/81126](https://support.google.com/a/answer/81126))
- Microsoft/Outlook weights **IP** reputation; SNDS is IP/ASN-centric and only
  available to dedicated-IP owners. ⚠️ *Verified only via secondary sources —
  Mailgun, Mailtrap, dmarcpal; no Microsoft primary page could be fetched.*
  → *on shared provider IPs, a domain split buys us nothing at Outlook.*

**So: is `news.postbox.help` worth doing?** Yes, and it should be done — but for
what it actually gives:

| It does | It does not |
|---|---|
| Give marketing its own Domain Reputation and Spam Rate line in Postmaster Tools | Keep us under the 5k/day bulk threshold (aggregates to the primary domain) |
| Let us see *which stream* is degrading, which today we cannot | Stop bad subdomain behaviour feeding the primary domain's compliance rating |
| Match near-universal ESP practice (Mailgun recommends it explicitly; Postmark enforces it structurally) | Help at Outlook, which weights IP |
| Keep marketing DKIM keys separate | Come free — a cold subdomain firing 10k on day one is a textbook filtering event |

Costs to accept with the split: new DKIM/DNS records; a deliberate DMARC
decision (a record at `_dmarc.postbox.help` is inherited by subdomains unless we
publish `sp=` or a subdomain-specific `_dmarc.news.postbox.help`; relaxed
alignment is the default and works, strict would not without a separate record);
and a warmup ramp on the new subdomain with no automatic help. ⚠️ *No
primary-source domain-warmup schedule from Resend was found.*

**Note on scope.** This is *our* domain split by traffic type. It is not the
per-client custom sending domains that were explicitly descoped — the
`sending_domains` table exists but is not part of this plan.

### 1.4 Alternatives for the bulk half

**Amazon SES with Tenants** ([docs.aws.amazon.com/ses/latest/dg/tenants.html](https://docs.aws.amazon.com/ses/latest/dg/tenants.html))
is the only surveyed provider that treats multi-tenancy as a product feature:

- Tenants are "isolated containers" with their own identities, config sets and
  **reputation metrics** — "this isolation ensures that a high bounce rate or
  complaint rate from one tenant doesn't impact the deliverability of emails
  sent by other tenants."
- **Per-tenant suppression lists** (`SuppressionScope=TENANT`) — the exact thing
  Resend lacks and §1.2 makes fatal.
- Reputation policies auto-pause the *offending tenant* without touching the
  others. AWS Trust & Safety likewise pauses the bad tenant, not the account.
- 10,000 tenants by default, up to 300,000 on request.
- AWS's own caveat, quoted: tenants' "combined sending activity still affects
  your overall account reputation." Isolation is strong, not absolute.

Cost, à la carte ($0.10/1,000, [aws.amazon.com/ses/pricing](https://aws.amazon.com/ses/pricing/)):
**50k → $5/mo · 250k → $25/mo · 1M → $100/mo.** Managed dedicated IPs $15/mo.
⚠️ *SES documents a per-tenant monthly charge but the pricing page did not
surface the line item — get a quote before committing at hundreds of tenants.*
⚠️ *Gmail does not feed complaint data to SES, so Gmail spam-button clicks will
not appear in SES suppressions. That blind spot is not SES-specific but it is
real for a consumer list.*

What SES does not give: no campaign builder, no segments, no unsubscribe
management, no List-Unsubscribe injection, webhooks via SNS/EventBridge rather
than HTTP. **All of that is exactly what `db/schema.ts` already models**, which
is the point — the schema in this repo was written for the SES shape.

For completeness, at 50k / 250k / 1M per month:

| Provider | 50k | 250k | 1M | Notes |
|---|---|---|---|---|
| **SES à la carte** | $5 | $25 | $100 | Build everything ourselves |
| **Resend** | $20 (Pro) | ~$160–350 (Scale) | $650 (Scale) | Plus contact-metered marketing bill |
| **Mailgun** | $35 (Foundation) | ⚠️ ~$255 extrapolated | ⚠️ ~$1,080 extrapolated | 1,000 sending domains on Foundation; dedicated IP pools on Scale. ⚠️ *No published pricing above 100k* |
| **SendGrid** | $19.95 (Essentials) | ⚠️ unverified | ⚠️ unverified | ⚠️ *Prices above 100k not published statically; subuser reputation isolation unassessed* |
| **Postmark** | ~$67 (Pro) | ⚠️ ~$328 extrapolated | ⚠️ ~$1,304 extrapolated | Excellent transactional; **explicitly declines marketing work** |

**Postmark** deserves a specific note even though it is not a bulk answer: its
Message Streams keep "transactional and broadcast traffic never intersect… including
IP ranges" ([postmarkapp.com/message-streams](https://postmarkapp.com/message-streams)),
which is the separation we are trying to hand-build with a subdomain, delivered
at the IP level — the level Outlook actually weights. It is worth considering
for the *transactional* half later. It is not a candidate for the bulk half;
Postmark says so themselves.

**Loops** is priced per subscribed contact and shaped for one company's
newsletter, not for a SaaS reselling newsletter capability. Not recommended.
**Customer.io was not researched** and no claim is made about it.

### 1.5 Recommendation

1. **Transactional stays on Resend, unchanged.** `replies@postbox.help` works,
   the integration is mature, and nothing here is a reason to touch it.
2. **Bulk does not go in the same Resend team.** §1.2 is disqualifying on its
   own, and the shared 10 rps team-wide rate limit is a second reason: a 10k
   campaign fired through `/emails` at 10 rps takes ~17 minutes and starves
   ticket replies for the whole of it.
3. **Target architecture: Amazon SES with one SES tenant per workspace, sending
   from `news.postbox.help`.** Per-tenant reputation isolation, per-tenant
   suppression and per-tenant auto-pause are precisely the multi-tenant failure
   modes, and the cost curve is 6× better at 1M/month. Our schema already
   assumes we own the audience, the recipient log and the send loop.
4. **Set up `news.postbox.help` regardless of provider** — with its own DKIM, a
   deliberate DMARC `sp=` decision, and a warmup ramp. Understand it as
   *observability plus partial insulation*, not as a firewall.
5. **If something must ship before a worker exists** — *superseded 22 August
   2026: the worker exists (§2.1), and `lib/deliver-ses.ts` implements
   recommendation 3 directly. This option is kept because it remains the
   fallback if SES onboarding stalls, and because the ⚠️ below is an open
   question about Resend that nobody has answered.* The cheapest honest path
   was **Resend Broadcasts in a SEPARATE Resend team**, from `news.postbox.help`.
   Resend does the queuing, throttling, scheduling and unsubscribe handling
   server-side — which sidesteps §2's entire problem — and a second team fixes
   the suppression bleed. The price is that Resend's Audience becomes a second
   copy of our subscriber list to keep in sync, our `campaign_recipients`
   idempotency design goes unused, and marketing is billed per contact.
   ⚠️ *Before relying on it, send a test broadcast and inspect the raw headers:
   Resend documents the unsubscribe flow but not the wire format, and it could
   not be confirmed that Broadcasts emits `List-Unsubscribe-Post`.*

---

## 2. Missing infrastructure

**This was the central obstacle and it is now half-closed.** `7900a5c` built the
queue-and-worker half; the argument below is preserved because the reasoning
still explains why the worker has the shape it has, but the facts have moved.

Concretely, as of 22 August 2026:

- `vercel.json` defines regions and a build command. It briefly also defined a
  cron (`/api/cron/campaigns` at `0 3 * * *`, added in `7900a5c`); that entry
  has since been removed and the sweep is scheduled by
  `.github/workflows/campaign-sweep.yml` every five minutes instead, because
  the Hobby plan rejects sub-daily expressions.
- There is still no Redis and no SQS, and none was added. **`campaign_recipients`
  is the queue** — it already had the claim latch, the unique index, the
  `attempts` counter and the `error` column, and a second queue beside it would
  mean two sources of truth about whether a person has been mailed. The
  `jobs` table proposed in `NEWSLETTER-BUILDER-PLAN.md` §2 Phase 2 was
  deliberately not built.
- `lib/rate-limit.ts` is **still in-memory**, and now matters more than it did:
  a cron can run concurrently with itself.
- Every server entry point is still a request handler, and the worker respects
  that rather than fighting it: it processes one bounded batch and returns
  (`RECIPIENTS_PER_SWEEP = 75`, `SWEEP_DEADLINE_MS = 45_000`,
  `maxDuration = 60`). A 40,000-recipient campaign is many invocations, not one
  long one.
- The auto-reply gap is **unchanged**: `SUPPORTED_DELAYS` in `lib/auto-reply.ts`
  is still `["immediate"]`. The campaign sweep did not generalise into the
  scheduler `5min` and `1hr` need, because it claims campaign recipients rather
  than arbitrary jobs.

What had to exist before phase two was wired up, and where each stands:

1. ~~**A durable, resumable worker.**~~ **Done.**
   `app/api/cron/campaigns/route.ts` — Vercel Cron hitting an authenticated
   route that processes one bounded batch and returns, exactly as prescribed
   here. The claim-before-send protocol (§4) is what makes a handler that dies
   mid-batch safe to re-invoke. The shared-secret check exists
   (`authorizeCronRequest`) and **fails closed**: no `CRON_SECRET`, no sweep for
   anybody. The paid-plan caveat was not resolved — the schedule is daily, which
   is the Hobby ceiling, and §0.9 records what that costs in throughput.
2. **A per-workspace send rate limiter that survives across invocations.**
   Not built. In-memory won't do. Without it one tenant's campaign consumes the
   whole provider quota and everyone else's mail stops.
3. **A bounce/complaint webhook endpoint** writing into `suppressions` (§6).
   Not built. Sending bulk without this is how an account gets terminated.
4. ~~**A public unsubscribe route** at `/u/[token]` accepting **unauthenticated
   POST** (§5).~~ **Done** in `14aa430` — see §5, which describes the built
   route.
5. **A reconciliation sweep** for rows stuck at `sent` with no
   `providerMessageId` — the known residue of claim-before-send (§4). Not built.
   Note that `reconcileSuppressedSubscribers()` is a *different* sweep (it
   retires recipients suppressed after materialisation) and does not cover this.
6. **A verified marketing sending domain** with DKIM, DMARC and a warmup ramp.
   Reported done for `news.postbox.help` in `eu-west-1`; unverifiable from the
   repository (§0.10).
7. **Consent enforcement.** `subscribers.consentMethod` / `consentAt` /
   `consentSource` are nullable and nothing currently requires them. A campaign
   send path must refuse addresses with no provenance — see §7. Not built, and
   §7 explains why that is a decision rather than an oversight.

---

## 3. The pipeline, end to end

```
   lists  ──┐
            ├─ (1) MATERIALISE ──► campaign_recipients (all "queued")
subscribers ┤        idempotent, sends nothing            │
            │                                             │
suppressions┘                                             ▼
                                          (2) CLAIM ──► status='sent'
                                              one row at a time
                                                          │
                                                          ▼
                                                   (3) PROVIDER SEND
                                                          │
                                                          ▼
                                       (4) WEBHOOK ──► delivered / bounced
                                                          │  / complained
                                                          ▼
                                              (5) SUPPRESS the address
```

Phase 1 is built. **Phase 2 is built and wired** — the cron sweep drives it, and
phase 3 is behind the delivery-mode switch. Phases 4–5 do not exist.

### Code map

| File | Role | Can it send? |
|---|---|---|
| `lib/newsletter.ts` | Pure: merge tags, rendering, audience selection, validation, unsubscribe URL/header construction. No DB, no network, no `process.env`. | No |
| `lib/campaign-send.ts` | IO: campaign CRUD, audience materialisation, the send loop, `claimDueCampaigns` and `settleCampaign`. Imports **no** email provider — the deliverer is an argument. | Only with a deliverer handed to it |
| `lib/campaign-cron.ts` | Pure sweep policy: the fail-closed auth check, the batch arithmetic, the summary fold. No DB, no env, no provider. | No |
| `lib/deliver.ts` | The factory. Returns the log deliverer unless `CAMPAIGN_DELIVERY_MODE=ses`, and throws rather than degrading if that mode is set with incomplete credentials. | It chooses which can |
| `lib/deliver-log.ts` | Records what would have been sent, mints a synthetic message id, contacts nothing. | No |
| `lib/deliver-ses.ts` | Builds the raw MIME message and calls SES. | **Yes** |
| `app/api/cron/campaigns/route.ts` | The worker: auth, envelope, deliverer, the per-campaign loop. **This is the file that made the pipeline reachable.** | Yes, given the env |
| `app/api/campaigns/**` | Create/read campaigns, preview and materialise audiences. Cannot change status. | No |
| `app/(dashboard)/newsletters/**` | The composer. Queues recipients; no Send affordance. | No |
| `app/u/[token]/**` | Unsubscribe: `GET` confirms, `POST` is the RFC 8058 one-click. | No |
| `tests/newsletter*.test.ts`, `tests/deliver*.test.ts`, `tests/campaign-cron.test.ts` | Pure logic only; run with no `DATABASE_URL`. | No |

The pure/IO split mirrors `lib/auto-reply.ts` / `lib/auto-reply-send.ts` and
exists for three reasons: the composer preview must run the same renderer the
send path runs; the tests must import it without a database (`db/index.ts`
throws at import time when `DATABASE_URL` is unset, and CI depends on it); and
it must stay safe to import from a client component.

> **`lib/newsletter.ts` must never import `lib/config.ts`, directly or
> transitively.** Config reads non-`NEXT_PUBLIC_` env vars, which do not exist
> in the browser; it has already taken production down once by crossing that
> boundary. Server-only values — the app URL, the unsubscribe mailto — are
> **passed in as arguments**. This is also why `renderTemplate` is duplicated
> from `lib/auto-reply.ts` rather than imported: that module pulls in
> `lib/config` transitively. If one changes, change both.

---

## 4. Audience materialisation and the claim-before-send loop

### Phase one — materialise (built, safe, exposed)

`materialiseAudience()` turns list membership into `campaign_recipients` rows,
all `queued`.

Selection is done by the pure `selectAudience()`, and the **order of operations
is load-bearing**:

1. **Malformed addresses dropped.** Not a person, so a repeat is not a
   "duplicate".
2. **Deduplicate — by subscriber id *and* by normalised email.** A campaign may
   draw from overlapping lists and the same human appears more than once. The id
   alone is insufficient: `subscribers` is unique on `(workspace_id, email)` at
   the index level, which is case-sensitive, so `Bob@x.com` and `bob@x.com` are
   two legitimate rows pointing at one mailbox. Sending both is the most
   reliable way to earn a complaint.
   Dedup runs **before** filtering so that every count that follows is a count
   of *people*, not rows — otherwise one suppressed person present three times
   is reported as three suppressions and the composer lies to the client about
   the size of the skip.
3. **Suppression beats subscriber status.** `suppressions` is keyed by email
   precisely so it still bites for an address that was deleted and re-added or
   never had a `subscribers` row. A re-imported CSV must not resurrect someone
   who reported us for spam.
4. **Status filter**, with `unsubscribed` / `bounced` / `complained` counted
   separately — the first is the client's own doing, the others are
   deliverability damage they need to see. The switch is exhaustive, so adding a
   `SubscriberStatus` is a build error rather than a silent send.

Address canonicalisation is lower-case + trim and **nothing else**. Plus-tags
and dots are *not* stripped: RFC 5321 makes the local part the receiving
server's business, and folding `a+news@x.com` into `a@x.com` would mean mailing
someone who asked us not to be mailed.

The write is one statement carrying the workspace predicate inside it:

```sql
INSERT INTO campaign_recipients (campaign_id, subscriber_id, email, unsubscribe_token)
SELECT c.id, s.id, v.email, v.token
FROM (VALUES …) AS v(subscriber_id, email, token)
JOIN subscribers s ON s.id = v.subscriber_id AND s.workspace_id = $ws
JOIN campaigns   c ON c.id = $campaign     AND c.workspace_id = $ws
ON CONFLICT (campaign_id, subscriber_id) DO NOTHING
RETURNING id
```

`ON CONFLICT … DO NOTHING` on the `(campaign_id, subscriber_id)` unique index is
the idempotency key. Re-running after a crash, a timeout, or a double-clicked
button adds only the rows that were missing and touches nothing that exists —
including rows already `sent`. **This is why materialisation is safe to expose
as a route while sending is not.**

It is refused once a campaign leaves `draft`/`scheduled`: adding unreviewed
recipients to a send already in flight is not a recoverable mistake.

### Phase two — claim, then send (built and wired)

`sendCampaignBatch()` in `lib/campaign-send.ts`, called from
`app/api/cron/campaigns/route.ts`. It still takes the delivery function as a
parameter with no default — that has not changed and should not — but the
"nothing imports it" property that used to be the safety story is **gone**. The
route imports it, and imports `createCampaignDeliverer()` alongside it. The
safety now rests entirely on which deliverer that factory returns and on the
three env gates in §0, which is a weaker guarantee than an absent caller and
should be read as such.

```sql
UPDATE campaign_recipients
   SET status = 'sent', sent_at = now(), attempts = attempts + 1
 WHERE id = $1 AND status = 'queued'
RETURNING id
```

The provider is called **only if that returned a row**. A concurrent worker, or
the same worker retried, gets zero rows and sends nothing. `status` is the claim
latch; the unique index from phase one is the idempotency key.

**The claim is one statement per row, on purpose.** Claiming a whole batch in a
single `UPDATE` would be faster and wrong: a crash mid-batch would leave every
row in it marked `sent`, silently dropping the entire batch instead of one
message.

**The cost, stated plainly:** this is claim-*before*-send. A crash between the
`UPDATE` and the provider call **loses that email rather than duplicating it**.
Losing one beats mailing someone twice. The residue is rows sitting at `sent`
with no `providerMessageId`, which needs a reconciliation sweep — one that does
not exist yet, and that must resolve against the provider by message id rather
than blindly re-sending, or it reintroduces the duplicate it was avoiding.

### Retries

- **Transient provider failure** → row goes to `failed` with the error text, not
  back to `queued`. Re-queueing would let a permanently rejected address be
  retried forever. `attempts` is already incremented, so a future retry sweep
  can distinguish "never tried" from "tried and failed".
- **Whole-campaign retry** → re-run materialisation (a no-op for existing rows),
  then run batches again. Only `queued` rows are claimable, so nothing already
  sent is touched.
- **A retry sweep for `failed` rows does not exist** and needs a policy: which
  errors are retryable, how many attempts, what backoff. Retrying a hard bounce
  is itself a deliverability offence.

---

## 5. Unsubscribe

Two mechanisms, both required.

**The visible footer link** is appended by the renderer to *every* campaign, in
both the text and HTML parts, regardless of what the author wrote. There is no
setting to turn it off. CAN-SPAM requires it, GDPR requires withdrawal to be as
easy as consent, and — decisively for a shared sending domain — one client
deleting it damages every other tenant. If the author also used
`{unsubscribe_url}` they get two links; a duplicated link is untidy, a missing
one is unlawful.

**The headers**, from `listUnsubscribeHeaders()`:

```
List-Unsubscribe: <mailto:…>, <https://postbox.help/u/TOKEN>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Things that make this work rather than merely be present:

- `List-Unsubscribe-Post` is what makes the HTTPS entry one-click (RFC 8058).
  Without it the header is a hint and clients keep offering the spam button as
  the easier route.
- **The URL must accept an unauthenticated `POST` and act immediately.** Mail
  providers POST it themselves. A page that requires a confirmation click is a
  non-compliant unsubscribe, and the provider's fallback for "unsubscribe didn't
  work" is the spam button. Gmail requires opt-outs honoured within 48 hours.
- The mailto is listed first for old clients that read only the first entry, but
  the HTTPS one satisfies RFC 8058. **Omit the mailto entirely if no mailbox is
  monitored** — a List-Unsubscribe pointing at an unread inbox is worse than
  none.
- Resend does **not** inject these for regular `/emails` sends. Their docs are
  explicit that you add them yourself. Only Broadcasts manages unsubscribe, and
  even there the wire format is undocumented (⚠️ §1.5).

**The token** is the per-recipient secret on `campaign_recipients`, from
`generateUnsubscribeToken()`. It is the only thing between a stranger and
unsubscribing anybody, so it must never be derived from an id, an address, or a
timestamp.

**Built** (`app/u/[token]/route.ts`, `lib/suppressions.ts`). `GET` does not
mutate — it 303s to a confirmation page, because link scanners fetch every URL
in a message — and `POST` is the unauthenticated, immediate one-click endpoint.
`unsubscribeByToken()` writes the `suppressions` row **and** moves
`subscribers.status` in one statement with data-modifying CTEs; status alone is
not enough, because the address can be deleted and re-imported.

The route is public only because `proxy.ts` lists `"/u/(.*)"` in
`isPublicRoute`. Remove that entry and the provider's one-click POST is
redirected to `/sign-in` and the opt-out silently stops happening.

Still open: the suppression reason is recorded as `'manual'` (the
`SuppressionReason` union has no `unsubscribe` member) with the real provenance
in the note, and the `lower(btrim(email))` matching has no functional index to
support it.

---

## 6. Bounces and complaints → suppressions

Not built. This is the feedback loop that keeps a sending reputation alive, and
sending bulk mail without it is how an account gets terminated.

The design the schema already assumes:

1. Provider webhook arrives (`email.bounced`, `email.complained`, or the
   equivalent SNS notification on SES).
2. Match it to a `campaign_recipients` row by `providerMessageId` — that column
   and its index exist for exactly this.
3. Update the recipient row: `bounced` / `complained`, plus `error`.
4. Update `subscribers.status` for the matching workspace + email.
5. **Upsert a `suppressions` row** — `hard_bounce` or `complaint`, with the
   provider diagnostic in `note`. This is the durable block; it is keyed by
   email so it survives the subscriber being deleted and re-added.
6. Dedupe deliveries by the provider's unique delivery id (`svix-id` on Resend)
   — webhooks are at-least-once.

Distinctions that matter and are easy to get wrong:

- **Soft bounces must not suppress.** A full mailbox is temporary; suppressing
  on it deletes a legitimate subscriber. Only hard bounces belong in
  `suppressions`.
- **A complaint must suppress immediately and permanently.** Never re-add on a
  subsequent import.
- **Gmail does not report complaints to SES**, so on SES the complaint signal
  for Gmail recipients is missing and Postmaster Tools spam rate is the only
  visibility. Budget for that.
- Resend's suppression list is team-wide (§1.2), so on Resend our own
  `suppressions` table and theirs would both apply, with theirs also silently
  blocking transactional mail. That is the whole argument for a separate team.

---

## 7. Consent — the part with legal teeth

`subscribers.consentMethod`, `consentAt` and `consentSource` are nullable, and
today **nothing enforces them**. The schema comment is unambiguous: "never
backfill these on import — an import with no provenance is an import we cannot
lawfully send to."

`subscribers` is deliberately not `contacts`. A contact raised a support ticket
and has given no marketing permission whatsoever; there is no FK between the two
tables and there must never be a feature that copies one into the other.
Marketing to contacts is unlawful in most of our markets.

**Before any send path is wired up**, `selectAudience` (or the layer above it)
should refuse candidates with no `consentAt`, and the import path should require
provenance. That is a deliberate omission right now, not an oversight — adding
the filter before there is a UI to capture consent would make every existing
seed subscriber unmailable and hide the problem.

---

## 8. What is built, and what it can't do

Accurate as of 22 August 2026.

**Built:**

- `lib/newsletter.ts` — merge tags with the "no `{token}` ever reaches a
  recipient" guarantee, deterministic text+HTML rendering with total escaping of
  data-derived content, audience selection (dedup / suppression / status),
  unsubscribe URL and header construction, campaign input validation.
- `lib/campaign-send.ts` — workspace-scoped campaign reads and writes,
  per-status recipient breakdown, audience preview, idempotent materialisation,
  the claim-before-send batch loop, `claimDueCampaigns` and `settleCampaign`.
- `lib/campaign-cron.ts` — fail-closed cron authorisation, the batch
  arithmetic, the sweep summary.
- `lib/deliver.ts`, `lib/deliver-log.ts`, `lib/deliver-ses.ts` — the deliverer
  contract, the log implementation, and a real SES implementation.
- `app/api/cron/campaigns/route.ts` plus the `crons` entry in `vercel.json` —
  the scheduler and the worker. This pair is what made the pipeline reachable.
- `app/(dashboard)/newsletters/` — the single-page composer, whose primary
  action is "Queue recipients". No Send affordance, by design.
- `app/u/[token]/` and `lib/suppressions.ts` — unsubscribe, plus
  `reconcileSuppressedSubscribers()`.
- `GET|POST /api/campaigns`, `GET|PATCH /api/campaigns/[id]`,
  `GET|POST /api/campaigns/[id]/audience`.
- `tests/newsletter.test.ts`, `tests/newsletter-audience.test.ts`,
  `tests/campaign-cron.test.ts`, `tests/deliver.test.ts`,
  `tests/deliver-ses.test.ts`, `tests/suppression.test.ts` — all pure, all run
  with no `DATABASE_URL`.

**Still not built:** the bounce/complaint webhook; consent enforcement; any way
for a user to move a campaign out of `draft`; the postal-address columns; a
cross-invocation rate limiter; the `sent`-without-`providerMessageId`
reconciliation sweep. The ordered list, with evidence for each, is §0.

**The sentence that used to close this section — "nothing can send email,
because `sendCampaignBatch` is imported nowhere under `app/`" — is false.** The
cron route imports it, and imports `createCampaignDeliverer()` beside it. The
guarantee that replaced the absent caller is the `CAMPAIGN_DELIVERY_MODE`
switch, and it is one environment variable rather than a structural
impossibility.

**Tenancy.** Every query follows `lib/labels.ts`. `campaigns`, `lists`,
`subscribers` and `suppressions` carry `workspace_id` and are filtered directly.
`campaign_recipients` and `list_subscribers` carry none and are joined up to a
parent that does. A campaign's `listId` is always read back off the campaign row
already proved to belong to the workspace — never taken from the request — so a
caller cannot point their campaign at another tenant's list. The audience
preview returns **counts only, never addresses**: an endpoint that dumped the
list would turn "can read one campaign" into "can export the marketing
database".
