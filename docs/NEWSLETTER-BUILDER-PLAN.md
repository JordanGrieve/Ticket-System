# Newsletter builder — decision document

Date: 2026-08-17. Author: research synthesis across five parallel investigations.
Scope: the **builder** (how a user composes a newsletter) plus project planning and cost.
Out of scope, owned elsewhere: the send pipeline and the bulk-email provider choice
(`docs/NEWSLETTER.md`).

Prices and limits below carry the date they were checked and the source. Anything that
could not be verified is marked **[unverified]**.

---

## 1. Recommendation up front

**Do not build the 4-step block wizard. Not yet, and possibly not ever in the form drawn.**

Build, in this order:

1. **Phase 0 — unblock sending.** The unsubscribe endpoint `/u/[token]` does not exist, so
   every unsubscribe link and every RFC 8058 one-click POST currently 404s. Add the route,
   add `legalName` and `postalAddress` to `workspaces`, and add `consentIp` to `subscribers`
   while that table is empty. About 3 days. Nothing else matters until this is done.
2. **Phase 1 — a single-page composer on the renderer that already exists.** Name, subject,
   preheader, a template dropdown with the two keys that exist, one plain-text body field with
   merge-tag insert buttons, live preview in an iframe, one list picker with a live count, and
   "send test to myself". About 8–10 days. This is a genuinely usable newsletter tool.
3. **Phase 2 — the cron sweep and job table**, which unblocks scheduled sends, delayed
   auto-replies and (later) ticket snooze. About 3–4 days on top of a Vercel Pro upgrade you
   owe anyway.
4. **Phase 3 — blocks, only if a trigger fires** (section 5). And when it does, evaluate
   `@react-email/editor` (MIT, from Resend, shipped 2026-04-17) before writing a block schema
   yourself.

The single sentence version: **the composer is not what is stopping you sending a newsletter —
the missing unsubscribe route, the missing postal address, the missing bounce handling and the
missing scheduler are.** Spend the next month on those and on a text composer, and let the pilot
client's actual behaviour decide whether block eleven ever gets built.

### Where the strands disagreed, and how I resolved it

This is the interesting part, so it goes near the top rather than buried.

**Disagreement 1 — build blocks or cut them.** Strands 1 (build-vs-buy) and 2 (email HTML)
both concluded "build a typed block list yourself", estimating 8–10 days and 4–6 weeks
respectively. Strand 5 (scope) concluded "cut blocks entirely, ship a text field".

They are not actually answering the same question. Strands 1 and 2 were asked *how* to build the
design and answered correctly: **if** you build a block builder, build it as a typed discriminated
union rendered by your own pure renderer, and do not pay $100–250/month for a third-party editor.
Strand 5 asked *whether* the design should be built at all at this stage.

**Resolution: strand 5 wins on sequencing, strands 1 and 2 win on architecture.** Cut blocks from
v1. When blocks arrive, build them as a typed block list feeding `lib/newsletter.ts`, exactly as
strands 1 and 2 describe — do not buy Unlayer, GrapesJS Studio or Stripo. The two positions are
compatible: strand 5 says "later", strands 1 and 2 say "and here is what later looks like".

Note that strand 1 estimated 8–10 days for the block list and strand 2 estimated 4–6 weeks for
the same work. That spread is itself evidence. Strand 2's estimate includes the Outlook
hardening, the multi-column story-card block, and 5–8 days of cross-client testing; strand 1's
does not, beyond "1–2d cross-client QA". **Believe strand 2's number.** Hand-written email HTML
is the classic under-estimate, and strand 2 is the strand that actually went and read
caniemail.com.

**Disagreement 2 — is `@react-email/editor` a good idea?** Strand 1 said "keep it in your back
pocket, it solves a different problem, it emits HTML and your architecture refuses stored HTML".
Strand 5 said "this is exactly why you should cut blocks now — the cost of adding them later just
fell". Both are right. It is not a replacement for a block list, but it is a plausible answer for
one *body copy* block later, and its existence lowers the cost of deferring.

**Disagreement 3 — how big is the infrastructure gap?** The brief called the missing queue "the
single biggest infrastructure gap". Strand 4 pushed back hard and, on the evidence, correctly:
Vercel functions now get **300s max duration on Hobby and Pro** with Fluid compute (checked
2026-08-17, vercel.com/docs/functions/configuring-functions/duration), so 1,000 recipients at
Resend's 100-per-batch limit is ten API calls, about a second. **The gap is not compute, it is
that nothing wakes up on a timer.** That is a cron problem, and a cron costs $0. This materially
shrinks the infrastructure work.

**Disagreement 4 — what is the primary legal risk?** The obvious answer is GDPR processor
paperwork. Strand 3 argues the primary risk is **PECR**, which attaches liability to whoever
"transmits, nor instigate[s] the transmission" of a marketing email — that is Postbox itself,
directly, not just the client. I have taken that seriously and put it in the blocking list.

---

## 2. The build, phased

Estimates are for **one developer already fluent in this codebase**, in focused working days.
They are estimates. The historical failure mode in email work is that cross-client rendering
takes two to three times what anyone predicts, so Phase 3's number should be read with more
suspicion than Phase 0's.

### Phase 0 — Make it legal to send one email (≈3–4 days)

| | |
|---|---|
| **Ships** | `app/u/[token]/route.ts` handling GET (a landing/confirm page) and POST (RFC 8058 one-click). Added to `isPublicRoute` in `proxy.ts`. No cookies, no Clerk session, no HTTPS redirect, idempotent, writes to `suppressions` synchronously. Plus `legalName` and `postalAddress` columns on `workspaces`, rendered unconditionally into the forced footer, with a draft-exit validation that refuses to proceed if either is empty. Plus a `consentIp` column on `subscribers`. |
| **Unlocks** | Legally sending anything at all. Everything else in this document is downstream of it. |
| **Depends on** | Nothing. All the hard parts are already written — `lib/newsletter.ts:417` already generates `${appUrl}/u/${token}`, `:439` already emits correct `List-Unsubscribe` and `List-Unsubscribe-Post` headers, and `:497` already force-appends the footer link. Only the receiving end is missing. |
| **Honesty note** | The 3–4 days assumes the migration and the settings UI for the postal address are trivial. If the settings page needs design work, add a day. |

### Phase 1 — Single-page composer (≈8–10 days)

| | |
|---|---|
| **Ships** | A `/campaigns` list page and draft CRUD over the existing `GET\|POST /api/campaigns`. A single composer page — not a wizard — with internal name, subject, preheader, a `<select>` over `TEMPLATE_KEYS` (`plain`, `branded`), and one `<textarea>` for the body, with buttons that insert the tokens already defined in `NEWSLETTER_MERGE_TOKENS`. Live preview in an **iframe via `srcDoc`**, fed by `renderCampaign()` directly. Desktop/mobile toggle, which is two iframe widths. One list picker plus the recipient count from the existing `/api/campaigns/[id]/audience` endpoint, **minus suppressions**. "Send test to myself" through the existing Resend transactional path. |
| **Unlocks** | A client can write, preview and test a newsletter. Combined with Phase 0, this is a shippable product for a text-first newsletter. |
| **Depends on** | Phase 0 for the unsubscribe link the preview will show. Nothing else. `renderCampaign()` is pure, has no DB/network/env dependency and is explicitly written to be importable from a client component — the preview genuinely is half a day. |
| **Honesty note** | Subscriber and list management with a CSV import that captures `consentMethod`/`consentAt`/`consentSource`/`consentIp` is **3–4 of those days** and is the single largest chunk. It is unavoidable on every path. Do not let it be discovered late. |
| **Deliberately not shipped** | The Send button. There is no worker yet. Ship no Send affordance rather than a disabled or fake one. |

### Phase 2 — Jobs table and cron sweep (≈3–4 days, plus a $20/month plan upgrade)

| | |
|---|---|
| **Ships** | One `jobs` table (`id, workspace_id, kind, payload jsonb, run_at, claimed_at, attempts, last_error`) with a partial index on `(run_at) WHERE claimed_at IS NULL`. One cron route at `app/api/cron/sweep/route.ts` with `export const maxDuration = 300`, guarded by a `CRON_SECRET` bearer check that **404s rather than 401s** on failure. Claim with `FOR UPDATE SKIP LOCKED` plus a stale-claim reclaim after 10 minutes. `"crons": [{ "path": "/api/cron/sweep", "schedule": "* * * * *" }]` in `vercel.json`, which currently has no `crons` key. Then flip `SUPPORTED_DELAYS` in `lib/auto-reply.ts:204` from `["immediate"]` to include `5min` and `1hr` — the UI already advertises delays the backend cannot honour. |
| **Unlocks** | Delayed auto-replies (first user-visible win, lands about day 3 of this phase). Campaign batch sending — `lib/campaign-send.ts` already implements claim-before-send, takes the sender as an argument, and is imported by nothing. Impersonation row cleanup. Later, ticket snooze. |
| **Depends on** | **Vercel Pro must be active first.** Hobby cron is once-per-day minimum, and a sub-daily cron expression fails *at deploy time* with an explicit error (vercel.com/docs/cron-jobs/usage-and-pricing, checked 2026-08-17). Sequence the upgrade before the `vercel.json` change or you will debug the wrong thing. |
| **Also do here** | Move `lib/rate-limit.ts` from its in-memory Map to a Postgres counter (half a day). It is honest in its own comment that it is only correct within a single instance; once a cron runs concurrently with itself, an in-memory limiter silently permits N× the intended send rate. |
| **Do not buy** | Inngest ($99/month above a 50k-execution free tier), Trigger.dev ($10–50/month), QStash (~$0.43/month but moves cancellation semantics into a vendor), Vercel Queues or Workflows (Workflows bills ~3 events per step at $0.02/1K — roughly $2.40 for a 40,000-recipient per-recipient workflow, versus $0 for a batch loop). All checked 2026-08-17. |

### Phase 3 — Blocks, images and everything else (≈4–6 weeks, only on a trigger)

| | |
|---|---|
| **Ships** | A typed discriminated-union `NewsletterBlock`, stored as JSONB, rendered by a pure `renderBlocks()` alongside `renderCampaign()` in `lib/newsletter.ts`. Ship **4–5 block types**, not ten: greeting, body copy, button, signature, footer. Plus an `<EmailShell>` carrying the MSO ghost-table wrapper, the `<o:PixelsPerInch>96` DPI fix, `mso-line-height-rule: exactly`, and the `color-scheme` meta pair. |
| **Unlocks** | Designed, multi-section newsletters. |
| **Depends on** | Object storage for any image block — there is none in the repo (grep for `upload\|S3\|blob\|r2\|cloudinary` across `lib/`, `app/` and `components/` returns only the word "blob" inside a comment). If images are wanted, Cloudflare R2 first: $0.015/GB-month, **$0 egress**, free tier 10 GB and 1M/10M ops (developers.cloudflare.com/r2/pricing, checked 2026-08-17). Egress is the one cost that scales with recipients, so R2's zero-egress asymmetry against Vercel Blob's $0.05/GB is worth taking now while switching is free. |
| **Honesty note** | Two of those weeks are cross-client testing and the defects it forces, not feature work. Assume the first real Outlook run surfaces 10–20 small fixes. Budget it explicitly or it will be discovered as a slip. |
| **Do first, whenever it happens** | Blocks + renderer + tests before any wizard UI. `lib/newsletter.ts` is pure and testable in CI by design. Building UI on an unvalidated renderer means rewriting the UI when Outlook forces a layout change. |

### Two fixes worth doing at any point, both under an hour

- **`lib/newsletter.ts` emits no `<head>` at all.** `plainShell` (line 574) and `brandedShell`
  (line 590) both go `<!doctype html><html><body>`. No `<meta charset="utf-8">` in a codebase full
  of typographic quotes is a mojibake incident waiting to happen; no viewport breaks mobile
  scaling; and the `<head>` is where the MSO DPI fix, the `color-scheme` metas, the media queries
  and the dark-mode rules all have to live. Highest value per minute available anywhere in this
  document.
- **`max-width:560px` and `border-radius:16px` on the branded shell are both ignored by the Word
  engine.** Classic Outlook will render the branded shell full-width in the reading pane today.
  If you are touching the shell to add `<head>`, add the ghost-table pattern and a fixed `width`
  at the same time.

---

## 3. Costs

### Recurring monthly, by subscriber volume

Assumes one newsletter send per subscriber per month, no images (Phase 1–2 scope). Volumes are
subscribers, and the send column assumes roughly 1 send each per month.

| Line item | 1k subs | 10k subs | 50k subs | Source / date |
|---|---|---|---|---|
| Vercel Pro (platform fee, 1 seat, incl. $20 usage credit) | $20 | $20 | $20 | vercel.com/docs/plans/pro-plan, 2026-08-17 |
| Vercel Cron + function invocations for the sweep | $0 | $0 | $0 | Included on all plans; ~43,200 invocations/mo ≈ 1.2 CPU-hours, inside the credit |
| Resend transactional (tickets, test sends) — Free tier | $0 | $0 | $0 | resend.com/pricing, 2026-08-17: 3,000/mo, 100/day |
| Resend transactional — Pro, if the 100/day cap bites | $20 | $20 | $20 | resend.com/pricing, 2026-08-17: 50,000/mo |
| **Bulk send** — owned by the other workstream | see note | see note | see note | `docs/NEWSLETTER.md` records an SES target of ~$5/mo at 50k emails |
| Resend Marketing, *if* used for bulk (priced by contacts) | $0 (free to 1,000) | $40 (5,000 tier) [unverified at 10k] | ~$650 at 150k tier [unverified at 50k] | resend.com/pricing, 2026-08-17 — the intermediate tiers between 5,000 and 150,000 contacts were not read |
| Neon Postgres | unchanged | unchanged | unchanged | Job table is a few thousand small rows |
| Cloudflare R2 (only if images ship) | $0 | $0 | $0 | Free tier 10 GB + free egress; real usage is far below it |
| Sentry | unchanged | unchanged | unchanged | Existing |
| **Realistic floor** | **$20/mo** | **$20–60/mo** | **$25–60/mo** | Excluding Resend Marketing, which is the expensive path |

Read the table this way: **the newsletter increment is close to zero. The looming platform cost is
$20/month for Vercel Pro, and you owe that the moment you invoice anyone, entirely independent of
newsletters** — the Hobby plan restricts users to "non-commercial, personal use only"
(vercel.com/docs/plans/hobby, checked 2026-08-17). The genuinely variable cost is the bulk-send
provider, and that decision is not this document's.

Two figures that will move the total more than anything above:

- **Resend Marketing is priced by contacts, not sends** — $0 to 1,000, from $40/mo at 5,000, up to
  $650/mo at 150,000. If bulk goes through Resend Marketing rather than SES, the cost curve is
  fundamentally different and 50k subscribers is a several-hundred-dollar line item. Worth
  flagging to the send-pipeline workstream.
- **Do not buy a dedicated IP.** Resend gates it above 3,000 emails/day so it is not purchasable
  at this scale, and below roughly 50,000 emails/month it actively hurts, because a low-volume
  dedicated IP generates too little signal for receivers to build a reputation on. (Vendor
  heuristic, sources vary — treat the 50,000 threshold as directional.)

### One-off costs

| Item | Cost | Note |
|---|---|---|
| Testi@ Pro cross-client rendering tests | **£16 per 31 days**, single payment, not a subscription — 130 clients including classic Outlook | testi.at/pricing, browser-verified 2026-08-17. Buy one or two months during active template work, then let it lapse. £16–48 total. |
| Legal: Art 28 DPA, Acceptable Use Policy, privacy-policy revision | **[unverified]** — likely the largest single one-off | No verified figure. This is real money and should be budgeted before the first paying client. |
| Domain warm-up | £0, but **4–8 weeks of calendar time** on a shared IP | Vendor heuristic. Publish the marketing domain's DNS *now*, in parallel with building, so it is not cold on launch day. |
| Google Postmaster Tools | $0 | Register day one even though it will show "insufficient data" for months. |
| SPF/DKIM/DMARC records | $0 | DNS only. |

### What you are declining to spend

Unlayer $250/mo, GrapesJS Studio SDK $200/mo, Stripo Plugin $100/mo (Unlayer and Stripo figures
came via search summaries rather than direct vendor fetches — **[partly unverified]**, re-check
before ever relying on them). Inngest $99/mo. Litmus, which no longer publishes a price at all —
litmus.com/pricing now redirects to a Validity Engage contact-sales form (browser-verified
2026-08-17); third-party trackers report $500/mo but Litmus itself confirms nothing. Mailgun
Inspect (formerly Email on Acid) $99/mo. At $18/mo per client, Unlayer alone needs ~14 paying
customers to break even on the editor.

---

## 4. What to cut, and what would trigger building it

| Cut | Why | Trigger to build it later |
|---|---|---|
| **The 4-step wizard shape** | Composing is non-linear — you revise the subject after seeing the audience size, and tweak the body after previewing. A wizard forces linear order and adds step state, per-step validation and back-navigation for no user benefit. No indie tool surveyed uses one: Keila and listmonk are both single-page. | Never, probably. If a client genuinely gets lost in a single page, add progressive disclosure, not steps. |
| **The Template step** | It is a radio group over a two-value string union. There is no templates table in the 809-line schema. It collapses to a `<select>` at zero cost. | Three or more real template layouts exist and are visually distinct. |
| **Blocks (all eleven types)** | The repo has already committed to a plain-text-body model: `campaigns.body` is `text().notNull()`, and `textToHtmlParagraphs()` escapes totally. Blocks mean a JSON migration, a per-block renderer pair (HTML *and* plain text), a rewrite of `renderCampaign()`, and rework of `tests/newsletter.test.ts` — which the send path depends on. Buttondown, a viable commercial product, has no visual builder at all. Keila shipped text first and added its block editor at v0.12.0 on 2023-05-01. | **Any of:** two or more *paying* clients ask for images or multi-column after each sending at least one campaign; a client sends four or more campaigns (the habit is real); a client asks to paste HTML or complains that pasted formatting flattened; object storage arrives for another reason such as ticket attachments. |
| **Hero image, header/logo, story cards** | No object storage exists. Two block types are blocked on unbuilt infrastructure, and a drag-and-drop canvas whose main affordance is images is not much use when you cannot host images. | Object storage lands. Then accept a URL string in v1 rather than building upload immediately. |
| **Multi-column layout (story cards, side-by-side feature lists)** | This is where 80% of the Outlook pain lives — it needs `<td>` columns plus an MSO conditional ghost-table wrapper, and it is the hardest single thing in the design. Flexbox and grid remain unusable: `gap` sits at 63.89% support with Outlook 2007–2019 at none (caniemail.com, checked 2026-08-17). | Only after a test loop against real classic Outlook exists. Ship single-column, stacked, until then. |
| **"Segments with live recipient counts"** | There are `lists`, not segments. No segment table, no stored filter predicate, no query-builder anywhere. `campaigns.listId` is a single nullable FK. The *counts* half is already backed — the audience endpoint exists. | A client has more than one meaningful audience within a list and asks to slice it. |
| **Drag-to-reorder** | Move-up/move-down covers 5–10 block emails, and can be added later behind the same data model without touching the renderer. | Blocks ship and someone complains. |
| **Font choice in the template picker** | A promise you cannot keep. `@font-face` is at 24.39% support and Gmail strips it entirely; worse, classic Outlook falls back to **Times New Roman**, skipping the rest of the stack — so declaring a web font can make Outlook worse than declaring none. The existing `Arial,sans-serif` discipline is correct. | Never. |
| **A dark-mode toggle or dark-mode preview** | Cannot be honoured. `prefers-color-scheme` is at ~42% (and caniemail's data was last tested 2023-03-08), Gmail's mobile apps force-invert with an undocumented algorithm, Yahoo and HEY rewrite the query so it never matches. | Never. Build defensively into the shell instead: the `color-scheme`/`supported-color-schemes` meta pair, avoid pure `#ffffff` and `#000000`, use solid-background PNGs for logos. |
| **A Send button in Phase 1** | There is no worker. A disabled or fake primary button is worse than none. | Phase 2 lands. |

---

## 5. Blocking prerequisites

Nothing here is optional. **A real newsletter cannot go out until all of these exist.**

### Legal obligations

1. **A working unsubscribe endpoint.** `/u/[token]`, GET and POST, HTTPS, no cookies, no HTTP
   auth, no redirect, idempotent (Gmail may POST more than once). Every unsubscribe link the
   product currently generates 404s. This is one day's work and it is the highest-priority item
   in the whole project.
2. **A physical postal address in every message.** CAN-SPAM requires it; there is no address
   field anywhere in `workspaces` (which has only name, apiKey, inboundEmail, sendingEmail,
   accent). Render it into the *forced* footer, not as an omittable merge tag, for the same
   reason the unsubscribe link is forced: one tenant deleting it damages every tenant on a shared
   domain. The `{company}` tag resolves to a display name, which is not a legal entity plus
   address. **[The 10-business-day opt-out window and the ~$53,088-per-message penalty figure are
   from settled statute and search summaries respectively — ftc.gov returned HTTP 403 to direct
   fetch on 2026-08-17.]**
3. **Consent provenance actually captured.** `consentMethod`/`consentAt`/`consentSource` exist and
   are nullable and nothing requires them. Add `consentIp` now while the table is empty — it is
   the ICO's simplest evidence item and painful to retrofit. Double opt-in is **not** legally
   required anywhere; treat it as a later per-list toggle and a paid-tier differentiator.
4. **An Art 28 DPA, an updated sub-processor list, and an Acceptable Use Policy with a consent
   warranty from each client.** This last one is Postbox's only real defence against **PECR
   liability as an instigator** — reg 22 binds anyone who transmits *or* instigates, and since
   the Data (Use and Access) Act 2025 the ceiling is £17.5m or 4% of worldwide turnover. The
   "we are only the processor" framing is correct for GDPR and irrelevant to PECR. **[ICO's own
   pages returned HTTP 403 on 2026-08-17; the ICO positions rest on secondary commentary and
   should be re-read directly before relying on them commercially.]**
5. **Never build a path that moves `contacts` into `subscribers`.** The schema deliberately has
   no FK between them and the comment at `db/schema.ts:503` says why — support contacts are not
   marketable. This is a one-line change a future self could make in five minutes under feature
   pressure, and it converts a compliant product into an unlawful one instantly. Consider a test
   that asserts the tables are never joined.

### Technical obligations

6. **SPF, DKIM and DMARC published for the marketing domain**, with `From:` aligned to the SPF or
   DKIM domain. `p=none` is enough to start. Same records satisfy Gmail, Yahoo and Microsoft.
   Register in Google Postmaster Tools day one.
7. **A bounce and complaint webhook writing into `suppressions`.** `app/api` contains no provider
   webhook route and nothing writes to that table, although the schema comment at
   `db/schema.ts:590` says "Every send MUST left-join this table and skip any hit". Without it, a
   hard-bounced or complaining address is re-mailed every campaign, which is precisely how you
   cross Gmail's 0.30% spam ceiling. Attribute the build to the send-pipeline workstream — but
   the builder's Audience count must subtract suppressions regardless, or the number shown to the
   user is a lie.
8. **Vercel Pro.** Required twice over: Hobby prohibits commercial use, and Hobby cron cannot run
   more than once a day (±59 minutes), which cannot drive a send worker.
9. **The cron sweep itself.** Nothing wakes up on a timer today. `vercel.json` has no `crons` key.
10. **Honouring unsubscribes within 48 hours** (Gmail) / **2 days** (Yahoo, "any method offered").
    Trivially met by a synchronous DB write in the `/u` route — do it in real time, do not defer
    it to the queue.

---

## 6. Risks, ranked

1. **The core product is unvalidated.** One pilot client, zero tickets. Building the second
   product's most expensive UI before the first product has processed a single ticket is the
   largest risk in the project, larger than anything technical here.
   *Mitigation:* Phase 1 is the smallest possible version of this bet — about 10 days on code
   that reuses a renderer that already exists. Do not spend 4–6 weeks on blocks first.

2. **PECR instigator liability lands on Postbox, not just the client.** £17.5m or 4% of turnover.
   "Our client said the list was consented" is a defence only if it was contractually warranted
   *and* technically enforced.
   *Mitigation:* an AUP with a consent warranty, an import gate that forces an explicit consent
   declaration and blocks unprovenanced imports from sending, and the technical ability to kill a
   tenant's sending.

3. **The shared-domain trap.** Gmail counts the 5,000/day bulk threshold **per primary domain,
   aggregating subdomains**, and bulk-sender classification is permanent — "Bulk sender status
   doesn't have an expiration date" (support.google.com/a/answer/14229414, fetched 2026-08-17).
   If every tenant sends from postbox.help their volumes add up, one shared reputation and one
   0.30% ceiling that any careless tenant can blow.
   *Mitigation:* decide per-tenant verified sending domains versus shared **now**, jointly with
   the send-pipeline workstream. Per-tenant is the right answer, also solves PECR reg 23's
   sender-identification problem, and gets harder to retrofit every week. Even on a shared domain
   for the pilot, the Send step must display which domain will be used and block on unverified.

4. **Flying blind on the metric that matters.** Postmaster Tools needs roughly 100–200 messages/day
   to Gmail to show anything **[unofficial figure]**. Postbox will be below that for months, so
   the 0.30% ceiling is unmeasurable externally until it is breached.
   *Mitigation:* instrument internally from webhook data — complaint rate per campaign and per
   tenant — and trip a circuit breaker at ~0.15%, well below the external ceiling.

5. **Email HTML is the classic under-estimate.** Two strands differed by 3× on the same work. The
   Word engine is still shipping and will be through at least 2029; classic Outlook is exactly
   what business recipients keep longest.
   *Mitigation:* build the renderer before any UI; ship single-column only; buy one month of
   Testi@ at £16 when the renderer is feature-complete and fix everything it surfaces before
   building on top.

6. **Overlapping cron invocations double-sending.** Vercel does not guarantee a sweep finishes
   before the next fires.
   *Mitigation:* `FOR UPDATE SKIP LOCKED` on the claim is not optional, plus a stale-claim
   reclaim after 10 minutes. `lib/campaign-send.ts` already uses this discipline — the hard part
   is written.

7. **The cron route is a send trigger reachable from the open internet.** The last two commits on
   this repo were specifically about hardening internet-reachable paths, and this adds a new one
   whose entire job is to email people.
   *Mitigation:* `CRON_SECRET` bearer check, 404 rather than 401 on failure so it does not
   advertise itself, and a test asserting an unauthenticated call 404s.

8. **Delayed auto-replies contradicting a human.** Once a 5-minute delay is real, the window
   exists where an agent replies first and the auto-reply arrives afterwards.
   *Mitigation:* delete the job row on any outbound reply to the same ticket. Two lines at build
   time, an embarrassing incident if skipped. Re-read `lib/auto-reply-guards.ts` against the
   delayed case — it was written for the immediate one.

9. **A plain-text composer reading as unfinished next to Mailchimp.**
   *Mitigation:* the `branded` shell already renders a workspace-named card layout, so text input
   still produces a designed-looking email. Show it in the preview by default.

10. **Gmail clips at ~102KB.** A block builder re-emits inline styles on every element, so a
    12-block newsletter can carry the same declaration 60+ times — and the thing clipped away
    below "View entire message" is the legally required unsubscribe footer.
    *Mitigation:* not a Phase 1 problem (a text body is small), but when blocks ship, add a byte
    readout to the composer and warn above ~80KB raw. Keep emitting the unsubscribe in the
    plain-text part too, which `unsubscribeFooterText` already does.

11. **Migrating `campaigns.body` from TEXT to JSON later.** Real, but cheap while zero campaigns
    have been sent, and it grows more expensive with every real campaign.
    *Mitigation:* this argues for deciding the content model deliberately, not for building blocks
    now. If blocks do arrive, add a `blocks jsonb` column and keep `body` as the plain-text
    fallback rather than converting in place.

12. **Multi-tenant blast radius on rendering defects.** One bad shell change ships to every
    recipient of every tenant at once and cannot be recalled — and because `templateKey` is
    stored rather than rendered HTML, a shell regression also retroactively changes how past
    campaigns render.
    *Mitigation:* snapshot tests over `renderCampaign()` output so shell changes produce a
    reviewable diff.

---

## 7. Open questions for Jordan

Each has a default. If you do nothing, the default applies.

1. **Was the pilot client promised a designed, image-led newsletter?**
   Nothing in the repo says so, and the absence of any written design decision is itself
   suggestive — `docs/NEWSLETTER.md` §8 lists "any dashboard UI" as simply not built.
   *Default: no. Ship the text composer.* If the answer is yes, the honest move is to renegotiate
   to a text newsletter for v1, not to spend six weeks on blocks.

2. **$18/mo or $189/mo?** This is the decision that determines the product shape, and it costs
   nothing but thought. $18 is market-plausible against EmailOctopus at $9/mo billed yearly
   (emailoctopus.com/pricing, 2026-08-17), and implies a self-serve tool where a text field is
   correct. $189 is roughly 20× the nearest indie comparable and implies a managed/agency product
   where a designed builder *is* the value proposition.
   *Default: decide before writing composer code.* No default price — this one genuinely needs an
   answer.

3. **Per-tenant verified sending domains, or one shared postbox.help?**
   *Default: build per-tenant.* It is more work now (3–5 days) and it only gets harder. If you
   defer, at minimum make the sending domain a per-workspace column now so the retrofit is a
   backfill rather than a redesign.

4. **Does the design intend blocks to be reorderable at all,** or is the numbered list a fixed
   template order? This materially changes the editor effort.
   *Default: moot for v1 (blocks are cut). Resolve before Phase 3 starts.*

5. **Are "story cards" and "feature list" side-by-side columns or stacked rows?** This single
   ambiguity is the difference between a straightforward renderer and the hardest part of the
   build.
   *Default: stacked. Single-column always, until a real Outlook test loop exists.*

6. **Do newsletter images need real access control, or is public-at-an-unguessable-path fine?**
   *Default: public at an unguessable path.* Signed URLs are actively wrong for email — a
   recipient's mail client presents no credentials and may open the message months later, so any
   expiring URL renders as a broken image. You are emailing the URL to thousands of strangers
   anyway. Only the *upload* side needs a signed URL.

7. **When (not whether) to upgrade to Vercel Pro.**
   *Default: before the first invoice, and before adding the `crons` key.* $20/month. It is a
   licensing cost, not a scheduling one.

8. **Buy one month of Testi@ (£16) now, or wait?**
   *Default: wait until the renderer is feature-complete,* then buy one month, fix everything, and
   let it lapse. Before then, use free real accounts — your own Gmail (web and phone), Outlook.com,
   and new Outlook for Windows — which cover most real-world opens at zero cost.

---

## 8. What we could not establish

| Unknown | Why it matters | What it would take |
|---|---|---|
| **Whether the wizard design was drawn against a stated client requirement or as a generic mock-up.** | Determines whether question 1 above has a painful answer. | Ask. Nothing in the repo, `docs/NEWSLETTER.md`, or the schema references a template picker, blocks, or segments. |
| **Litmus's actual price.** litmus.com/pricing 302-redirects to a Validity Engage contact-sales form (browser-verified 2026-08-17). Third-party trackers say $500/mo Core after an August 2025 repricing; Litmus confirms nothing. | Only matters if Testi@ proves inadequate. | Contact sales, or don't — Testi@ at £16 is the recommendation regardless. |
| **Unlayer and Stripo pricing** came from search summaries, not direct vendor-page fetches. The GrapesJS figures were fetched directly. | Only matters if a buy decision is ever revisited. | Fetch unlayer.com/pricing and plugin.stripo.email directly before relying on the numbers. |
| **ICO and FTC primary sources.** Both returned HTTP 403 to direct fetch on 2026-08-17. The soft opt-in conditions, the "double opt-in is advisory" position, the CAN-SPAM 10-business-day window and the ~$53,088 per-message penalty all rest on secondary commentary or settled-law recall. | These underpin section 5. | Read ico.org.uk direct-marketing guidance and the FTC CAN-SPAM compliance guide in a browser before relying on them commercially. Cheap. |
| **Whether react-email officially supports Next.js 16 and React 19.2.** The changelog names neither; only secondary blogs claim it. | Blocks Phase 3 if it turns out not to work under Turbopack. | A one-hour branch spike: render one block server-side and the same block in a client component, confirm identical HTML. Do this *before* building block components, not after. If Next complains about `react-dom/server`, add the package to `serverExternalPackages` in `next.config.ts`. |
| **`@react-email/editor`'s gzipped browser bundle size.** npm reports 1,598,629 bytes unpacked, which includes ESM + CJS + types and is not a bundle size. npmjs.com returned 403; no bundlephobia figure found. | It must be a client component, so it sits on the critical path of the composer route. | Install it in a branch and read the Turbopack output. |
| **Vercel Queues' per-operation rate**, and **Vercel Blob's lhr1 rates.** Both pricing pages defer to regional tables that were not retrieved; the Blob figures quoted ($0.023/GB, $0.05/GB transfer) are from a worked example explicitly for iad1. | Only matters if the R2 / cron recommendations are overruled. | Fetch vercel.com/docs/pricing/regional-pricing. |
| **Whether R2 requires a custom domain for public newsletter image serving.** Cloudflare's `r2.dev` URL is documented as development-oriented and rate-limited. | Adds a DNS and Cloudflare dependency to the send path if so. | Read developers.cloudflare.com/r2/buckets/public-buckets/ before designing the image block. |
| **Real-world email image egress.** Mail clients (Gmail especially) proxy and cache images, so bytes served are far below recipients × size. Cache duration and hit rate could not be established. | Makes the R2-vs-Blob case weaker than the naive arithmetic suggests. | Measure after shipping. R2 costs $0 either way, so the conclusion is unchanged. |
| **Google Postmaster Tools' minimum volume threshold.** Not published by Google; 100–200/day is a community estimate. | Determines how long you are flying blind. | Register and watch. |
| **The percentage of 2026 opens with images disabled.** Every figure traces back to Gmail's 2013 change (the 43% number) and is obsolete. The qualitative fact — Outlook blocks by default, Gmail and Apple Mail do not — is solid; the magnitude is not. | Affects how hard to lean on required alt text. | Require alt text regardless; it is free. |
| **Whether the bulk provider will constrain the HTML it accepts, or want templates uploaded provider-side.** | Could change the storage-format decision before any migration lands. | Ask the send-pipeline workstream once the provider is chosen. |
| **Whether the pilot client has a designer, a logo, or any image assets.** | If not, the hero-image and logo blocks are unused features regardless of storage. | Ask. |

---

## Appendix: repo facts this document relies on

All verified by reading the repository on 2026-08-17.

- `lib/newsletter.ts:49` — `TEMPLATE_KEYS = ["plain", "branded"] as const`. Two templates, a string
  union, no templates table.
- `db/schema.ts:634-635` — `campaigns.templateKey` and `campaigns.body`, both `text().notNull()`.
- `lib/newsletter.ts` header comment — the module touches no DB, network or env so the composer
  preview runs the *same* renderer the send path runs, and stays importable from a client
  component. Line 46 on `templateKey`: a stored blob "freezes a campaign against every future fix
  to the layout".
- `lib/newsletter.ts:417, :439, :497` — unsubscribe URL generation, `List-Unsubscribe` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, and the force-appended footer link
  all exist and are correct. No `app/u` route exists to receive any of it.
- `lib/newsletter.ts:574, :590` — `plainShell` and `brandedShell` emit no `<head>`.
- `lib/auto-reply.ts:204` — `SUPPORTED_DELAYS = ["immediate"]` while `DELAY_LABELS` at :210 lists
  `5min` and `1hr`. The UI offers delays the backend cannot honour.
- `lib/campaign-send.ts` — claim-before-send batch loop, takes the sender as an argument with no
  default, imported by nothing. Header comment: the loop is written "so that wiring it up later is
  a scheduling problem rather than a correctness problem".
- `db/schema.ts:656` — `campaigns_scheduled_idx` on `(status, scheduledAt)`, commented "The
  scheduler sweeps status = 'scheduled' by due time." The table exists; the scheduler does not.
- `db/schema.ts:590` — suppressions: "Every send MUST left-join this table and skip any hit."
  Nothing writes to it; there is no webhook route under `app/api`.
- `db/schema.ts:503` — no FK between `contacts` and `subscribers`, deliberately.
- `vercel.json` — has `regions` and `buildCommand`, no `crons` key.
- `lib/rate-limit.ts` — in-memory fixed-window limiter, correct only within a single instance, by
  its own admission.
- No object storage anywhere: grep for `upload|S3|blob|r2|cloudinary` across `lib/`, `app/` and
  `components/` hits only the word "blob" in a comment.
- Ticket snooze: zero matches across all `.ts`/`.tsx`/`.md` outside `node_modules`. It does not
  exist.
