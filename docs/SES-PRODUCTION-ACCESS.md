# SES production access request

Draft for the "Request production access" form in the Amazon SES console
(**Region: eu-west-1 / Ireland** — the project's assigned Region; the request
is per-Region and this is the only one Postbox may create resources in).

Written 22 August 2026. Every claim below is true of the deployed code at
`ddc1537`. **Do not soften or embellish it** — AWS reviewers do check the
things they ask about, and the whole value of this request is that the answers
are verifiable.

---

## 1. Before you submit — do these first

The reviewer is deciding whether you will damage the shared reputation of SES
IP space. Two of the four answers below are only true once the AWS side is
wired, and submitting first means answering "yes, we handle bounces" while the
topic that would deliver them does not exist.

- [ ] **Wire the SNS bounce/complaint topic.** Full steps are on the Asana task
      "Wire SES bounce/complaint feedback in AWS (eu-west-1)". Until
      `SES_SNS_TOPIC_ARN` is set in Vercel and the HTTPS subscription is
      confirmed, `/api/webhooks/ses` returns 503 and no bounce reaches the
      suppression list.
- [ ] **Confirm the sending domain is verified** with DKIM signing enabled, and
      that SPF and DMARC records resolve. (DMARC was corrected in Cloudflare on
      a previous pass — re-check it still resolves before submitting.)
- [ ] **Send at least one real campaign in sandbox** to a verified address, so
      the answer to "have you tested" is yes.
- [ ] **Fill in the two figures marked `<<>>` below.** Do not guess high — a
      modest, accurate number is approved more readily than an ambitious one,
      and the limit can be raised later.

---

## 2. Form fields

| Field | Answer |
|---|---|
| Mail type | **Marketing** |
| Website URL | `https://postbox.help` |
| Use case description | The text in §3 |
| Additional contacts | *(leave empty)* |
| Preferred contact language | English |

---

## 3. Use case description — paste this

> Postbox (https://postbox.help) is a small multi-tenant email platform I
> build and operate. It sends two kinds of mail: transactional replies for a
> support-ticket inbox, and opt-in newsletters that our business customers send
> to their own subscribers. This request is for the newsletter sending.
>
> **Who we send to.** Only addresses that have completed a double opt-in. A
> person enters their address on a signup form, we send a confirmation link,
> and nothing is stored until they press it. Submitting the form writes no
> record at all — the pending state is carried in a signed token in that one
> email, so an address cannot be added to a list by anyone other than the
> person who can read that mailbox. We do not import purchased lists, we do
> not append addresses from third parties, and we have no path that adds a
> subscriber without a confirmed click.
>
> **What we record as evidence.** For every subscriber we store the consent
> method, the timestamp of the confirming click, the URL of the page the form
> was on (taken from the browser's own Origin/Referer headers, never from a
> field in the request body), and the IP address the confirmation came from.
> An address with no consent record is excluded from every send by the audience
> selection code, not by convention.
>
> **Unsubscribing.** Every message carries RFC 8058 one-click headers
> (List-Unsubscribe and List-Unsubscribe-Post) plus a visible footer link. The
> unsubscribe endpoint requires no account and no login, and the link is
> per-recipient. Unsubscribing writes to a suppression list that is enforced
> inside the SQL statement that claims each recipient, so an opt-out that
> lands mid-send takes effect for that send.
>
> **Bounces and complaints.** SES bounce and complaint notifications are
> delivered to an SNS topic and consumed by an authenticated endpoint that
> verifies the SNS message signature and pins the topic ARN. Permanent bounces
> and all complaints are added to the suppression list immediately and the
> subscriber is marked accordingly; transient bounces are recorded but do not
> suppress, so a full mailbox does not cost someone their subscription. A
> suppressed address is never resurrected by a later signup or import.
>
> **Identification.** Every marketing message includes the sender's legal name
> and physical postal address. The platform refuses to send for any customer
> who has not supplied one — the field is deliberately left empty rather than
> defaulted, so there is no way to send with a placeholder address.
>
> **Volume.** We expect roughly <<N>> messages per month initially, to a total
> audience of about <<M>> confirmed subscribers across all customers, growing
> slowly. Sending is rate-limited by a scheduled worker rather than sent in
> bursts.
>
> I am the sole operator and monitor bounce and complaint rates directly. If
> either rises, I stop the affected customer's sending rather than continue.

---

## 4. If it is rejected

A first-time rejection is usually one of: no verifiable website, a vague
answer about list sources, or no described bounce handling. All three are
covered above, so a rejection most likely means something in §1 was not
actually live when they checked. Fix it, then reply on the same case rather
than opening a new one.

Do not raise the sending limit request and the production access request
together. Get out of the sandbox first at the default limits.
