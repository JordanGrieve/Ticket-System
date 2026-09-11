# What Postbox costs to run, and what the tiers should be

**11 September 2026.** Every vendor price below was fetched from the live
pricing page today, not recalled. Where a figure could not be confirmed it says
so rather than guessing — an invented number here would propagate into a plan
you charge real money against.

Conversions use **$1 = £0.79**. That rate is an assumption and nothing else in
this document checks it; if it has moved materially, the dollar figures are the
ones to trust.

---

## 1. The short answer

| Question | Answer |
| --- | --- |
| What does a 30-day trial cost us? | About **6 pence**, not £6 |
| What does a paying client cost us? | **3p to £5.30 a month**, depending on tier |
| What are the fixed costs? | **£32.60 a month**, and they barely move with client count |
| How many clients to break even? | **Two** on Growth, three on Starter, one on Business |
| Are £12 / £29 / £59 profitable? | Yes — **89% to 97% gross margin** at every tier |

The important finding is the shape, not the numbers. **Almost all of this
cost is fixed.** One more client, or one more trial, costs pennies. So pricing
should be set by what the product is worth to a bakery, not by what it costs
us — the cost floor is too low to be the constraint.

---

## 2. Vendor prices, as published today

| Service | Free tier | Paid |
| --- | --- | --- |
| **Neon** (Postgres) | 100 CU-hours/mo, 0.5 GB storage | $0.106 per CU-hour, $0.35 per GB-month, **no fixed fee** |
| **Vercel** | Hobby, but **commercial use is prohibited** | Pro **$20 per member/mo**, includes $20 usage credit |
| **AWS SES** | **None any more** — only $200 of time-limited new-account credit | **$0.10 per 1,000** emails sent |
| **Resend** | 3,000/mo, **capped at 100/day** | Pro $20/mo for 50,000 |
| **Clerk** | **50,000 monthly retained users** | $25/mo, only needed far beyond our scale |
| **Sentry** | 5,000 errors/mo | $26/mo billed annually |
| **Stripe UK** | — | **1.5% + 20p** on UK domestic cards |

Three of these need flagging before anything is decided.

**Vercel Hobby forbids commercial use, explicitly.** The fair-use guidelines
say Hobby teams are restricted to non-commercial personal use, and that any
deployment for the financial gain of anyone involved — including a paid
consultant writing the code — requires Pro. The moment Postbox invoices
anyone, Hobby is a policy violation. Treat **$20/month as mandatory**, not
optional.

**SES no longer has a perpetual free tier.** The old 62,000-from-EC2 allowance
is gone. Every email is billed from the first one.

**Neon's first paid plan has no monthly fee.** It is pay-as-you-go. If you
have $19/month for Neon in any spreadsheet, it is stale.

---

## 3. What a client actually costs

Email is the only cost that scales with a client. Everything else is fixed.

### Emails per client per month

Assumptions, stated so you can argue with them: one auto-reply per enquiry,
one notification per agent per enquiry, two agent replies per enquiry, and two
emails per newsletter signup (the confirmation and the thank-you).

| | Starter | Growth | Business |
| --- | ---: | ---: | ---: |
| Enquiries a month | 100 | 400 | 2,000 |
| People on the account | 1 | 3 | 10 |
| Emails per enquiry | 4 | 6 | 13 |
| Enquiry emails | 400 | 2,400 | 26,000 |
| Subscribers | 0 | 1,000 | 10,000 |
| Campaigns a month | 0 | 4 | 4 |
| Campaign emails | 0 | 4,000 | 40,000 |
| Signup emails | 0 | 200 | 1,000 |
| **Total emails** | **400** | **6,600** | **67,000** |
| **Cost at SES** | **£0.03** | **£0.52** | **£5.29** |

**One number there is a design problem, not a cost problem.** A Business
client's notification emails are 26,000 of their 67,000 — 39% — because every
one of ten people is emailed about every one of 2,000 enquiries. That is a
digest waiting to be built, and it would cut their cost by a third and their
inbox noise by much more.

### Margin per tier

| | Starter £12 | Growth £29 | Business £59 |
| --- | ---: | ---: | ---: |
| Stripe fee (1.5% + 20p) | £0.38 | £0.64 | £1.09 |
| Net received | £11.62 | £28.36 | £57.91 |
| Email cost | £0.03 | £0.52 | £5.29 |
| **Gross margin** | **£11.59** | **£27.84** | **£52.62** |
| **Margin %** of price | **96.6%** | **96.0%** | **89.2%** |

---

## 4. Fixed costs, and break-even

| Item | USD/mo | GBP/mo | Notes |
| --- | ---: | ---: | --- |
| Vercel Pro | $20 | £15.80 | Mandatory. **Per member** — a second seat doubles it |
| Resend Pro | $20 | £15.80 | Needed the moment one active client exists |
| Neon | $0–25 | £0–19.75 | Free under 100 CU-hours. **Confirm in the dashboard** |
| Clerk | $0 | £0 | 50,000 retained users free |
| Sentry | $0 | £0 | 5,000 errors free |
| Domain | — | ~£1 | |
| **Total** | | **£32.60–£52.35** | |

**Break-even, at £32.60 of fixed cost:**

| Tier | Contribution each | Clients needed |
| --- | ---: | ---: |
| Starter | £11.59 | 3 |
| Growth | £27.84 | 2 |
| Business | £52.62 | 1 |

Everything after that is close to pure margin, because nothing in the fixed
column grows with client count until you are far bigger than this.

### Why Resend Pro is not optional

The free tier is 3,000 emails a month **and 100 a day**. A single Growth client
generates about 6,600 a month and could easily do 200 in a day when a campaign
goes out. The daily cap breaks first, and it breaks silently for the client.

**There is a way to remove this £15.80 entirely.** Transactional mail currently
goes through Resend while campaigns go through SES. Once SES production access
lands, moving transactional to SES too replaces a $20/month subscription with
$0.10 per thousand — roughly **70p a month** for all three example clients
combined. That is a real saving worth doing after the SES case is settled, and
not before, because it would put every ticket reply behind the same unverified
domain the campaigns are stuck behind.

### The Neon number I could not compute for you

Neon bills by CU-hour, and the compute wakes whenever anything touches the
database. Three scheduled jobs do that on a fixed cadence, whatever the client
count:

| Job | Cadence | Wake-ups a day |
| --- | --- | ---: |
| Auto-reply sweep | every 15 minutes | 96 |
| Campaign sweep | hourly | 24 |
| Health check | daily | 1 |

With a five-minute idle timeout, a wake every fifteen minutes keeps the
database up roughly a third of the time — about 240 wall-clock hours a month.
Whether that costs nothing or $25 depends entirely on the compute size, which
I cannot see from here.

**Open the Neon dashboard and read the actual CU-hours for last month.** It is
the single number in this document I had to leave open, and if it is near 100
then the fifteen-minute sweep — not your clients — is your biggest variable
cost, and slowing it is the cheapest saving available.

---

## 5. The trial

You asked for 30 days or a usage cap, costing about £6.

**A capped trial costs about 6 pence** (£0.063). At today's limits — 100 conversations
and 100 subscribers — a trial that used every bit of its allowance generates
roughly 800 emails, which is **$0.08**. The database and hosting costs do not
move, because the scheduled jobs run whether a trial exists or not.

Your £6 budget would buy roughly **76,000 emails** — about 95 trials' worth. No honest trial is
anywhere near that.

So the £6 is not a cost ceiling, it is a fixed-cost allocation — "how much of
the £32.60 may one trial absorb". At £6 that is a fifth of the monthly fixed
cost per trial, which only makes sense if trials are rare and converting.

**The cap that matters is not financial.** A generous trial's real risk is a
stranger using it as a spam cannon: SES reputation is shared across every
tenant, so one abusive trial damages the deliverability of every paying
client's mail. That is not a £6 problem, it is an existential one, and it is
the reason to keep the caps tight regardless of what they cost.

**My recommendation:** 30 days, 100 conversations, 100 subscribers, and — new
— a **500-email ceiling**, which is the one that actually stops abuse. That
trial costs about 4p and cannot be turned into a sending platform.

---

## 6. Suggested plan limits

The tiers are profitable at almost any price above about £5, so the ladder is
fine. What is missing is the limit that corresponds to the thing we actually
pay for.

**You sell subscribers; we pay for emails.** A Growth client with 1,000
subscribers costs the same whether they send monthly or daily — except they
do not: daily is 30,000 emails against 4,000. Nothing in the product notices.

| Tier | Seats | Conversations/mo | Subscribers | **Emails/mo (new)** | Worst-case cost | Margin at cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Starter £12 | 1 | 500 | 0 | **3,000** | £0.24 | 94.9% |
| Growth £29 | 3 | 2,000 | 1,000 | **15,000** | £1.19 | 93.7% |
| Business £59 | 10 | 10,000 | 10,000 | **80,000** | £6.32 | 87.4% |

Even at the cap, every tier clears 87%. The email ceiling is not there to
protect margin — it is there so that one client cannot quietly become the
whole SES bill, and so that runaway sending is caught by us rather than by
Amazon.

---

## 7. Images and products in emails

**Today: not possible.** The campaign body is authored as plain text and
escaped completely before it becomes HTML, so a client pasting `<img src="…">`
sees the tag as literal text in their email. That escaping is load-bearing and
should not be relaxed: it is what stops a subscriber whose name contains
markup from injecting anything into what everybody else receives. Bare URLs
are turned into links; nothing else is interpreted.

So images need a deliberate feature, and it should be **structured fields, not
HTML in the body**.

**What I would build, in order:**

1. **A hero image.** One image URL and one alt text on a campaign, rendered
   above the body at the shell's 560px width. This covers "here is a photo of
   this week's bake" and is a day's work.
2. **Product blocks.** A small repeatable list of image, name, price and link,
   rendered as a grid that collapses to one column on a phone. This is the
   "products they sell" case and is the larger of the two.

**Where the images live matters more than how they render.** The cheapest
version has the client paste a URL from their own website or shop, which costs
us nothing and works immediately. The alternative is building uploads, which
means storage, an `attachments` table that currently has no code behind it,
and a file-size policy. Storage itself is trivially cheap — a hundred clients
with twenty product photos each is a few hundred megabytes — but the work is
not.

**Three constraints that decide the design, not the decoration:**

- **Gmail and Outlook block images by default.** The email has to read
  correctly with every image missing, which makes alt text mandatory rather
  than nice, and means the price and the link can never live only inside a
  picture.
- **An emailed image is permanent.** If a client deletes the file from their
  shop next year, every email ever sent breaks. That is an argument for
  hosting them ourselves eventually, and for warning clients meanwhile.
- **A remote image is a tracking pixel whether you intend it or not.** Postbox
  does no open tracking today, which is a genuinely good position to be in
  under GDPR. Adding images should not quietly become adding tracking.

---

## 8. What I could not confirm

1. **Your actual Neon CU-hours.** The one number that could change the fixed
   costs materially. It is in the Neon dashboard.
2. **Vercel's European regional rates.** The published CPU, memory and
   transfer prices are US "starting at" figures; Europe has a multiplier on a
   separate page.
3. **SES pricing in eu-west-1.** No regional table is published. Uniform
   pricing is an inference from its absence, not a stated fact.
4. **Resend's per-email overage rate.** The page says one exists without
   publishing it. It does not matter if transactional moves to SES.
5. **The exchange rate.** £0.79 to the dollar is my assumption throughout.
