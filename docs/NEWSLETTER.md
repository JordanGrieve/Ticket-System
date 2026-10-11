# Newsletter / campaigns

How bulk marketing mail works in Postbox, what gates it, and what is still
missing. **Current as of 11 October 2026.** This replaces a document written
around Amazon SES; SES was removed on 14 September 2026 and the layered
corrections that version carried are gone with it. The provider research that
chose SES is summarised in §7 for the record.

Read `db/schema.ts` alongside this. The doc comments on `subscribers`,
`suppressions`, `campaigns` and `campaign_recipients` encode decisions this
page only elaborates on.

## 0. State

**It sends.** The first real campaign left on 14 September 2026 through
Resend: 6 delivered, 0 failed. Signup, welcome email, composer, scheduling,
"Send now", the hourly sweep, unsubscribe, and bounce and complaint
suppression are all live. Campaign sends count against the workspace's
monthly email allowance and the platform's daily Resend quota.

What gates a send, in order. The first three are environment switches, each
failing closed on its own:

1. **`CRON_SECRET`** — unset, the sweep route returns 503 to every caller.
2. **`CAMPAIGN_FROM_ADDRESS`** — unset, the sweep 503s before a deliverer is
   constructed. No fallback to the transactional sender, so a marketing
   complaint cannot land on the domain carrying every tenant's ticket replies.
   The workspace's name is put in front of the address per send
   (`campaignFromHeader`), because a subscriber signed up to a shop, not to us.
3. **`CAMPAIGN_DELIVERY_MODE=resend`** — anything else, including the stale
   `ses`, selects the log deliverer, which records what would have been sent
   and contacts nobody.
4. **A postal address on the workspace** — `renderCampaign` refuses without
   one, the send loop refuses the batch, and the schedule route refuses to arm
   the campaign. CAN-SPAM identification; the one thing the statute is
   specific about.
5. **At least one confirmed subscriber** — the readiness checklist says
   "Nobody has confirmed a subscription yet" and points at the signup form.
6. **The monthly email allowance** — the send loop budgets each batch against
   what is left, sends that many, leaves the rest queued, and the composer
   shows `email_allowance_spent`. An unreadable counter is treated as zero,
   never as unlimited.

Items still missing, from `BACKEND-REVIEW.md` and since:

- A SQL backstop for consent. It is enforced once, in `selectAudience` at
  materialisation; suppression is enforced three times in SQL.
- Placeholder validation server-side: a direct API call can arm a campaign
  still carrying the template's `[brackets]`.
- Liveness for the sweep: nothing notices if GitHub stops scheduling it.
- A retry policy for `failed` recipient rows, and a reconciliation for rows at
  `sent` with no provider id (the documented residue of claim-before-send).
- Named lists. `lists` and `list_subscribers` stay in the schema; nothing on
  the send path reads them.

## 1. Signup and consent

`POST /api/subscribe/:key` is public, rate-limited in Postgres, honeypotted,
and signs its confirmation links with `SUBSCRIBE_TOKEN_SECRET` (falling back
to the inbound secret). **Single opt-in is the default** since 14 September:
the address goes on the list at submission and the welcome email goes out
immediately. `workspaces.require_signup_confirmation`, operator-set from the
console, puts one workspace back on double opt-in without a deploy. It is
operator-set because the risk it manages — a list filling with typos and
strangers' addresses, whose bounces and complaints degrade delivery for every
other client — belongs to the platform, not the workspace.

Consent evidence is written on every row: `consentMethod`, `consentAt`,
`consentSource` (which says which act it was: single opt-in at submission or
a confirmed double opt-in) and the page URL and IP, taken from `Origin` and
`Referer` rather than from the body. `selectAudience` refuses a candidate with
no `consentAt`, so an import with no provenance is unmailable.

`subscribers` is deliberately not `contacts`. A contact raised a support
ticket and gave no marketing permission; there is no foreign key between the
tables and there must never be a feature that copies one into the other.

## 2. The welcome email

`lib/welcome.ts` (pure) and `lib/welcome-store.ts` (IO). Sent the moment
somebody subscribes, in the client's branding with their name, accent,
sign-off, an optional image and products, through the same `renderCampaign`
the composer uses. **On by default**: absence of a settings row means the
default, and the default sends; a row that says off is off. Still gated on
the postal address.

It is the safety valve for single opt-in, not a courtesy. The form is public,
so anybody can type somebody else's address into it; the person who receives
a welcome they did not ask for needs an unsubscribe in front of them, because
the alternative they reach for is the spam button.

## 3. The pipeline

```
subscribers ──┐
              ├─ (1) MATERIALISE ──► campaign_recipients, all "queued"
suppressions ─┘        idempotent, sends nothing            │
                                                            ▼
                                            (2) CLAIM ──► status = 'sent', one row at a time
                                                            │
                                                            ▼
                                                     (3) RESEND /emails
                                                            │
                                                            ▼
                                      (4) /api/webhooks/resend ──► bounced / complained
                                                            │
                                                            ▼
                                               (5) SUPPRESS the address
```

### Code map

| File | Role |
| --- | --- |
| `lib/newsletter.ts` | Pure: merge tags, text and HTML rendering with total escaping, hero image and products, audience selection, unsubscribe URL and headers, validation. No DB, no network, no `process.env`. Importable from a client component. |
| `lib/campaign-send.ts` | IO: campaign CRUD, `workspaceAudience`, materialisation, the claim-before-send loop, `claimDueCampaigns`, `settleCampaign`. The deliverer is an argument; `draftColumns()` makes a forgotten field a compile error. |
| `lib/campaign-sweep-run.ts` | The one send loop, called by the cron route and by the schedule route's inline "Send now" pass. |
| `lib/campaign-cron.ts` | Pure sweep policy: fail-closed auth, batch arithmetic, the summary. |
| `lib/campaign-schedule.ts` | Pure: arming rules, `SWEEPS_PER_DAY = 24`, `SWEEP_CADENCE`, the estimates the screen shows. |
| `lib/campaign-health.ts` | Pure: the readiness checklist and blockers, including the allowance. |
| `lib/deliver.ts`, `lib/deliver-log.ts`, `lib/deliver-resend.ts` | The factory, the log deliverer, the Resend deliverer. `lib/delivery-failure.ts` classifies errors. |
| `lib/usage.ts`, `lib/usage-store.ts` | Monthly usage counters per workspace; the email allowance. |
| `lib/email-quota.ts`, `lib/email-quota-store.ts` | The platform-wide daily Resend quota; counted, warned, never enforced. |
| `lib/suppressions.ts`, `lib/campaign-feedback.ts` | Unsubscribe, bounce and complaint handling into `suppressions`. |
| `lib/campaign-requeue.ts`, `lib/campaign-reconcile.ts` | Put a wholly-failed campaign back; surface rows the claim loop lost. |
| `app/api/cron/campaigns/route.ts` | The worker: auth, envelope, deliverer, the sweep. |
| `app/api/campaigns/**` | CRUD, audience counts, schedule and abort, duplicate, requeue, delete, test send. |
| `app/(dashboard)/newsletters/**` | The composer, split into panels; the welcome email under `welcome/`. |
| `app/u/[token]/**`, `app/s/**` | Unsubscribe (GET confirms, POST is RFC 8058 one-click); the hosted signup pages. |

`lib/newsletter.ts` must never import `lib/config.ts`, directly or
transitively. Config reads server-only env and once took production down by
crossing into the browser. Server values are passed as arguments.

### Materialise

`materialiseAudience()` turns every confirmed subscriber in the workspace
into `campaign_recipients` rows, all `queued`, through `selectAudience`, whose
order of operations is load-bearing: malformed addresses dropped; deduplicated
by id **and** by normalised email (the unique index is case-sensitive, so
`Bob@x.com` and `bob@x.com` are two rows for one mailbox); suppression beats
status; no consent beats everything; then the status filter, with
`unsubscribed`, `bounced` and `complained` counted separately so the client
sees deliverability damage as distinct from their own choices. The INSERT
carries the workspace predicate and `ON CONFLICT DO NOTHING` on
`(campaign_id, subscriber_id)`, so re-running after a crash adds only what
was missing. Refused once a campaign leaves `draft` or `scheduled`.

### Claim, then send

```sql
UPDATE campaign_recipients
   SET status = 'sent', sent_at = now(), attempts = attempts + 1
 WHERE id = $1 AND status = 'queued'
RETURNING id
```

The provider is called **only if that returned a row**. A concurrent sweep,
or the same one retried, gets zero rows and sends nothing. One statement per
row, on purpose: a batch-wide UPDATE would mark the whole batch sent on a
crash. The cost, stated plainly: a crash between the UPDATE and the provider
call loses that one email rather than duplicating it. The Resend deliverer
adds a per-recipient idempotency key derived from the message, which turns
that trade into a free one in the common case.

The batch is budgeted **before** any claim: `min(RECIPIENTS_PER_SWEEP,
allowance remaining this month)`, and the counter is incremented as rows are
claimed, so it cannot drift from what was sent.

### Send now, and the sweep

"Send now" is the same code path as a scheduled send with the timestamp
resolved to now, followed by an inline pass of the sweep loop bounded to that
one campaign and twelve seconds. It cannot fail the request: by then the
campaign is armed and every unreached row is still queued for the hourly
sweep. The screen reports the server's own counts rather than the word
"Sent". Why not a faster cron: every scheduled tick wakes the Neon compute,
five-minute sweeps ran at roughly 180 CU-hours against a 100-hour allowance,
and Neon answers an overage by suspending the compute.

### The Resend deliverer

Resend's limit is 10 requests a second per **team**, shared with
transactional mail. The deliverer paces itself across the whole sweep and
retries a 429, and only a 429: a timeout may already have been accepted, and
retrying that is how somebody gets mailed twice. A daily or monthly quota also
arrives as a 429 and means the opposite thing; those classify `paused` so the
sweep stops hammering a provider that has said no.

Resend's Broadcasts product is **not** used: it is billed by contacts, can
only reach contacts stored in Resend's own Audiences, and its unsubscribe link
unsubscribes from Resend's audience rather than from our `subscribers` table.

### Retries

A transient provider failure writes the row `failed` with the error and
`attempts` incremented; it does not go back to `queued`, or a permanently
rejected address would be retried forever. A campaign that reached **nobody**
can be requeued and returned to draft (`lib/campaign-requeue.ts`); one that
reached anybody cannot, because retrying beside a delivered row risks a
duplicate. There is still no retry sweep with a policy for which errors are
retryable.

## 4. Unsubscribe

Two mechanisms, both required, neither optional per client.

The **footer link** is appended by the renderer to every campaign and welcome
email, text and HTML, regardless of what the author wrote. The **headers**
are `List-Unsubscribe` with a mailto and the HTTPS URL, and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Resend does
not inject these for `/emails` sends; we do.

`app/u/[token]/route.ts`: GET does not mutate (link scanners fetch every URL
in a message) and 303s to a confirmation page; POST is the unauthenticated,
immediate one-click endpoint. `unsubscribeByToken()` writes the `suppressions`
row **and** moves `subscribers.status` in one statement, because status alone
is not enough: the address can be deleted and re-imported. The route is public
only because `proxy.ts` lists `/u/(.*)`; remove that and the provider's
one-click POST redirects to sign-in and the opt-out silently stops.

## 5. Bounces and complaints

`POST /api/webhooks/resend` receives transactional and campaign events on the
same endpoint and must treat them differently: a bounced ticket reply is
between a business and its own customer, and suppressing on it could stop
them answering an open enquiry. Which kind an event is gets decided by
matching the provider's message id against `campaign_recipients`, never by
reading the `from` address, which is attacker-supplied in a webhook body. The
workspace comes from the campaign the matched row belongs to.

Suppression happens **before** the recipient row is updated, chosen for what
a crash between them leaves: an address suppressed with a row still reading
"sent" is a report slightly wrong; the reverse is an address marked bounced
that gets mailed again next month. Soft bounces do not suppress; a complaint
suppresses permanently. Feedback matching nothing at all — not a campaign
recipient, not a ticket message — is counted in `feedback_drops` and shown in
the console, because that state means ids have stopped being stored and
every bounce has silently stopped suppressing anyone.

## 6. Tenancy

`campaigns`, `subscribers` and `suppressions` carry `workspace_id` and are
filtered directly. `campaign_recipients` carries none and is joined up to its
campaign. The audience preview returns counts only, never addresses. Every raw
statement is checked by `tests/tenancy-invariants.test.ts`; the one exempt
update in the feedback path carries a written reason (its id was derived from
a join to `campaigns` in the same function).

## 7. The provider decision, for the record

Research in August 2026 chose Amazon SES for bulk mail on a correct argument:
SES tenants give per-workspace reputation isolation and per-tenant
suppression, which nothing else surveyed offers, and Resend's suppression
list is team-wide, so one tenant's complaint could silently block another
tenant's ticket replies. AWS denied production access on 26 August (case
178747420600793), leaving the account sandboxed and able to reach only
verified addresses. On 11 September campaigns were routed through Resend's
`/emails` API, and on 14 September the SES adapter, SNS webhook, env vars and
docs were deleted rather than maintained against an API nothing would call.

What that leaves true: every tenant shares one Resend team, one monthly
allowance, one daily cap and one sending reputation. The controls are the
500-email trial ceiling, suppression on bounce and complaint, the welcome
email's unsubscribe link, the operator's double opt-in switch, and the plan
email allowances. Per-tenant verified sending domains remain the better
answer and are an open decision in `HUMAN_ACTIONS.md`. Gmail counts its
5,000-a-day bulk-sender threshold across subdomains of a primary domain, and
bulk-sender status never expires, so a marketing subdomain gives observability
rather than a firewall.
