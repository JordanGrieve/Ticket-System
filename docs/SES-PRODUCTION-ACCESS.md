# SES production access request

Draft for the "Request production access" form in the Amazon SES console
(**Region: eu-west-1 / Ireland** — the project's assigned Region; the request
is per-Region and this is the only one Postbox may create resources in).

Written 22 August 2026. Every claim below is true of the deployed code at
`ddc1537`. **Do not soften or embellish it** — AWS reviewers do check the
things they ask about, and the whole value of this request is that the answers
are verifiable.

---

## 1. Before you submit — ALL DONE, verified 23 August 2026

The reviewer is deciding whether you will damage the shared reputation of SES
IP space. Every answer below is now true and demonstrable. Verified, not
assumed:

- [x] **SNS bounce/complaint topic wired.** Topic
      `arn:aws:sns:eu-west-1:479127223828:postbox-ses-feedback`, access policy
      allowing `ses.amazonaws.com` to publish (conditioned on SourceAccount),
      configuration set `postbox-newsletters` publishing BOUNCE, COMPLAINT,
      REJECT and RENDERING_FAILURE to it, and an HTTPS subscription to
      `https://postbox.help/api/webhooks/ses` in state ACTIVE.
      The subscription **auto-confirmed**, which is the proof that matters: the
      route verified a genuine SNS RSA signature, matched the TopicArn, checked
      the SigningCertURL host and fetched the SubscribeURL, against real AWS.
- [x] **Sending domain verified with DKIM.** `news.postbox.help`, DKIM status
      SUCCESS, signing enabled, custom MAIL FROM `bounce.news.postbox.help`
      status SUCCESS. Email feedback forwarding turned OFF so bounces arrive
      once, via SNS.
- [x] **A real message has been sent in sandbox and its headers inspected.**
      Sent 23 Aug 09:24 to a verified address. Gmail reported **SPF: PASS**,
      **DKIM: PASS (d=news.postbox.help)**, **DMARC: PASS**. The message
      carried `List-Unsubscribe` (https, one-click capable) and
      `List-Unsubscribe-Post: One-Click`, and the CAN-SPAM footer with the
      sender's postal address.
- [x] **Volume figures filled in below.**

> Gmail filed that first message as Spam, with the reason "similar to messages
> that were identified as spam in the past" — a content/reputation judgement,
> not an authentication failure. Expected for a subdomain that had never sent
> before. Nothing a sender controls was wrong. Worth knowing, and worth not
> panicking about, but also a reason to grow volume gradually rather than
> importing a list on day one.

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
> **Volume.** This is a small operation and I would rather be accurate than
> ambitious: fewer than 500 messages per month initially, to a total audience
> of roughly 200 confirmed subscribers across all customers, growing slowly as
> customers grow their own lists. Sending is paced by a scheduled worker that
> processes a small batch every few minutes, so mail goes out steadily rather
> than in bursts. I would rather start at a modest limit and request an
> increase later than be granted headroom I do not need.
>
> I am the sole operator and monitor bounce and complaint rates directly. If
> either rises, I stop the affected customer's sending rather than continue.

---

## 3b. IT WAS DENIED — 23 August 2026, case 178747420600793

`aws sesv2 get-account` reports `ReviewDetails.Status: DENIED`, with
`EnforcementStatus: HEALTHY` — so this is NOT a reputation or complaint
problem. The Support API needs a paid support plan, so the stated reason is
only readable in the console or the notification email.

**The most likely cause, and it is fixable.** The eu-west-1 console form has no
free-text use-case field. The assessment is therefore made against the website
— and on the day of the request, postbox.help described only the support-ticket
product: “support tickets that feel like an inbox”, contact forms, threaded
replies. Nothing about newsletters, subscribers, consent or unsubscribe. A
**Marketing** request judged against that page is a mismatch a reviewer is right
to refuse. The page also said “invite-only”, so they could not sign up and look.

That has been fixed: https://postbox.help/#newsletters now describes confirmed
opt-in, the consent record, one-click unsubscribe and suppression, and
https://postbox.help/s/cli_fdcd84f4e0f013a2a6703efdac6ec277 is a live, public,
working double opt-in form a reviewer can use.

### Reply on the SAME case. Do not open a new one.

A new case restarts the queue and loses the history. Paste §3 above as the body,
prefaced with this:

> Thank you for reviewing this. I think the refusal is fair on what you could
> see: the website described only our support-inbox product and said nothing
> about the newsletter side, which is what this request was actually for. There
> was no free-text field on the form to explain it.
>
> I have since published that half of the product. https://postbox.help/#newsletters
> sets out how subscribers are collected and how they leave, and
> https://postbox.help/s/cli_fdcd84f4e0f013a2a6703efdac6ec277 is a live signup
> form you are welcome to test end to end — it will send you a confirmation link
> and will not add you to anything unless you press it.
>
> The full detail follows. If any of it is the wrong shape for what you need,
> please say which part and I will answer specifically.

**Then add these, which are specific and checkable:**

- The sending domain is `news.postbox.help`, verified with DKIM, with a custom
  MAIL FROM of `bounce.news.postbox.help`.
- A test message sent in the sandbox on 23 August passed SPF, DKIM and DMARC,
  and carried `List-Unsubscribe` (https) and `List-Unsubscribe-Post: One-Click`.
- Bounce and complaint events publish to SNS topic
  `arn:aws:sns:eu-west-1:479127223828:postbox-ses-feedback`, consumed by an
  endpoint that verifies the SNS signature AND pins the topic ARN. Permanent
  bounces and all complaints suppress immediately; transient bounces do not.
- Every message carries the sender’s postal address, and the platform refuses
  to send for any customer who has not supplied one.

**Do not** bundle a sending-limit increase into the reply. Ask only for
production access at default limits.

---

## 4. If it is rejected

A first-time rejection is usually one of: no verifiable website, a vague
answer about list sources, or no described bounce handling. All three are
covered above, so a rejection most likely means something in §1 was not
actually live when they checked. Fix it, then reply on the same case rather
than opening a new one.

Do not raise the sending limit request and the production access request
together. Get out of the sandbox first at the default limits.
