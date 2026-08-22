import { json } from "@/lib/http";
import {
  classifySesNotification,
  isAllowedSnsUrl,
  parseSnsEnvelope,
  topicArnAllowed,
  verifySnsSignature,
  type SnsEnvelope,
} from "@/lib/ses-events";
import {
  applyProviderFeedback,
  noteProviderFeedback,
} from "@/lib/suppressions";

/**
 * POST /api/webhooks/ses — Amazon SES bounce and complaint feedback, via SNS.
 *
 * This closes the deliverability loop described in docs/NEWSLETTER.md §6. SES
 * publishes Bounce and Complaint events to an SNS topic; SNS POSTs them here;
 * hard bounces and complaints become rows in `suppressions`, which every send
 * path already consults. Without it a bounced address stays on the list and is
 * mailed again next campaign, the account's bounce rate never recovers, and
 * Amazon eventually withdraws production access — for every tenant at once,
 * including their transactional ticket mail.
 *
 * ── THE FOUR CHECKS, IN ORDER, ALL FAIL-CLOSED ──
 *
 *  1. `SES_SNS_TOPIC_ARN` must be configured. Unset is a deployment fault, not
 *     permission to accept everything — the same lesson as /api/inbound, which
 *     shipped failing OPEN and was world-writable.
 *  2. `TopicArn` must be one we were told to trust. A valid SNS signature only
 *     proves the message came from SNS, not from OUR topic: anyone can create
 *     a topic, subscribe this URL, and publish a perfectly-signed "bounce".
 *  3. `SigningCertURL` must be a real `sns.<region>.amazonaws.com` .pem. The
 *     certificate URL chooses the key the signature is checked against, so an
 *     attacker-controlled one turns the signature check into theatre — and
 *     fetching it is an outbound request from inside our network, i.e. an SSRF
 *     if the host is not pinned.
 *  4. The RSA signature over the canonical string must verify.
 *
 * Only after all four does anything get written or fetched. In particular the
 * `SubscribeURL` of a SubscriptionConfirmation is fetched ONLY after the
 * message has been proven to come from our own topic, and is itself re-checked
 * against the same host rule.
 *
 * ── WHY EVERYTHING VERIFIED RETURNS 200 ──
 *
 * SNS retries non-2xx aggressively and, after enough failures, disables the
 * subscription — which silently switches the feedback loop off, the exact
 * failure this endpoint exists to prevent. So a verified message returns 200
 * whether it was processed, ignored as an uninteresting event type, or
 * unmappable to a workspace. Non-2xx is reserved for messages that failed
 * verification (they are not ours) and for our own transient faults, where a
 * retry is what we actually want.
 */

// Node, not edge: node:crypto RSA verification.
export const runtime = "nodejs";
// Reads the request body and headers; never cache a webhook.
export const dynamic = "force-dynamic";

export const SES_TOPIC_ARN_ENV = "SES_SNS_TOPIC_ARN";

export async function POST(req: Request) {
  const raw = await req.text();

  const expectedTopic = process.env[SES_TOPIC_ARN_ENV];
  if (!expectedTopic) {
    console.error(
      `[ses-webhook] ${SES_TOPIC_ARN_ENV} is not set. Refusing every request: ` +
        "an unpinned endpoint accepts validly-signed messages from anyone " +
        "else's SNS topic, which is a write into any workspace's suppression " +
        "list. Set it to the ARN of the topic SES publishes feedback to.",
    );
    return json({ error: "SES feedback webhook not configured." }, { status: 503 });
  }

  const msg = parseSnsEnvelope(raw);
  if (!msg) {
    return json({ error: "Not an SNS message" }, { status: 400 });
  }

  if (!topicArnAllowed(msg.TopicArn, expectedTopic)) {
    console.warn("[ses-webhook] refused unknown TopicArn:", msg.TopicArn);
    return json({ error: "Unknown topic" }, { status: 403 });
  }

  if (!isAllowedSnsUrl(msg.SigningCertURL, { requirePem: true })) {
    console.warn(
      "[ses-webhook] refused SigningCertURL:",
      msg.SigningCertURL.slice(0, 200),
    );
    return json({ error: "Invalid signing certificate URL" }, { status: 400 });
  }

  const cert = await fetchSigningCert(msg.SigningCertURL);
  if (!cert) {
    // OUR failure, not theirs. 503 so SNS retries — dropping the message would
    // lose a bounce permanently.
    return json({ error: "Could not fetch signing certificate" }, { status: 503 });
  }

  if (!verifySnsSignature(msg, cert)) {
    console.warn("[ses-webhook] signature verification failed for", msg.MessageId);
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── Verified from here down ──────────────────────────────────

  switch (msg.Type) {
    case "SubscriptionConfirmation":
      return confirmSubscription(msg);
    case "UnsubscribeConfirmation":
      // Someone deleted the subscription in the AWS console. There is nothing
      // to do programmatically, but it means the feedback loop just went dark,
      // which is worth a loud line in the logs.
      console.warn(
        "[ses-webhook] SNS subscription was REMOVED for topic",
        msg.TopicArn,
        "— bounce and complaint feedback has stopped until it is re-subscribed.",
      );
      return json({ ok: true, type: msg.Type });
    case "Notification":
      return handleNotification(msg);
  }
}

/**
 * Confirm the subscription by fetching `SubscribeURL`.
 *
 * Reached only for a message whose signature verified against an Amazon
 * certificate AND whose TopicArn is one we trust, so the URL is not
 * attacker-supplied. It is re-validated against the host rule anyway: the two
 * checks defend different things (provenance vs. destination), and the cost of
 * the second is one function call.
 *
 * `.pem` is not required here — a SubscribeURL is a query-string endpoint on
 * the same host, not a certificate.
 */
async function confirmSubscription(msg: SnsEnvelope): Promise<Response> {
  const url = msg.SubscribeURL ?? "";
  if (!isAllowedSnsUrl(url)) {
    console.error(
      "[ses-webhook] SubscribeURL rejected despite a valid signature:",
      url.slice(0, 200),
    );
    return json({ error: "Invalid SubscribeURL" }, { status: 400 });
  }

  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      console.error("[ses-webhook] SubscribeURL returned", res.status);
      // 503 → SNS resends the confirmation, which is recoverable.
      return json({ error: "Confirmation failed" }, { status: 503 });
    }
    console.info("[ses-webhook] confirmed SNS subscription for", msg.TopicArn);
    return json({ ok: true, confirmed: true });
  } catch (err) {
    console.error("[ses-webhook] SubscribeURL fetch error:", err);
    return json({ error: "Confirmation failed" }, { status: 503 });
  }
}

/**
 * Process one bounce/complaint notification.
 *
 * Every branch below returns 200. The interesting ones are the branches that
 * DO NOTHING:
 *
 *  • `kind: "transient_bounce"` — a full mailbox or a greylist. Recorded
 *    against the send for the campaign report and otherwise ignored. Blocking
 *    on it would permanently delete legitimate subscribers whenever a large
 *    ISP has a bad hour, and `suppressions` is not undone by re-importing.
 *  • no `messageId`, or a `messageId` that matches no recipient row — the
 *    bounce cannot be attributed to a workspace. This happens legitimately:
 *    transactional ticket mail sent through the same configuration set has no
 *    `campaign_recipients` row at all. The alternative to dropping it is
 *    suppressing globally, which would let one tenant's bounce silence an
 *    address for every other tenant.
 */
async function handleNotification(msg: SnsEnvelope): Promise<Response> {
  const feedback = classifySesNotification(msg.Message);

  if (feedback.kind === "other") {
    console.info("[ses-webhook]", feedback.summary);
    return json({ ok: true, ignored: true, eventType: feedback.eventType });
  }

  if (!feedback.messageId) {
    console.warn(
      "[ses-webhook] no SES messageId on a",
      feedback.eventType,
      "— cannot attribute it to a workspace; dropped.",
    );
    return json({ ok: true, ignored: true, reason: "no_message_id" });
  }

  if (feedback.kind === "transient_bounce") {
    const diagnostic = feedback.recipients[0]?.diagnostic;
    if (diagnostic) {
      await noteProviderFeedback({
        providerMessageId: feedback.messageId,
        note: diagnostic,
      });
    }
    console.info("[ses-webhook]", feedback.summary, feedback.messageId);
    return json({ ok: true, suppressed: 0, reason: "transient" });
  }

  let suppressed = 0;
  let unmapped = 0;

  for (const r of feedback.recipients) {
    // Defensive: classify already guarantees these are set for the two
    // suppressing kinds, and a null here must never be read as "block anyway".
    if (!r.suppress || !r.recipientStatus) continue;

    const outcome = await applyProviderFeedback({
      providerMessageId: feedback.messageId,
      email: r.email,
      reason: r.suppress,
      recipientStatus: r.recipientStatus,
      note: r.diagnostic,
    });

    if (!outcome.matched) {
      unmapped += 1;
      console.warn(
        `[ses-webhook] ${feedback.eventType} for SES message ${feedback.messageId} ` +
          "matched no campaign_recipients row — not a campaign send, or the " +
          "message id was never recorded. Nothing suppressed.",
      );
      continue;
    }

    suppressed += 1;
    if (outcome.recipientEmail && outcome.recipientEmail !== r.email) {
      // Worth knowing about: the mailbox that rejected is not the one we
      // addressed (forwarding, aliasing). The provider's address is the one
      // blocked, deliberately — see applyProviderFeedback.
      console.warn(
        "[ses-webhook] address mismatch: sent to",
        outcome.recipientEmail,
        "but the provider reported",
        r.email,
      );
    }
    console.info(
      `[ses-webhook] ${feedback.summary} — blocked ${r.email}` +
        ` (new=${outcome.suppressionCreated}, subscribers=${outcome.subscribersUpdated})`,
    );
  }

  return json({ ok: true, suppressed, unmapped });
}

// ── Signing certificate ──────────────────────────────────────────

type CachedCert = { pem: string; fetchedAt: number };

/**
 * Amazon rotates the SNS signing certificate rarely, and every single
 * notification names it. Without a cache this endpoint makes a second outbound
 * request per bounce — during a large send that is a request storm against
 * Amazon and a latency multiplier on a handler SNS is timing.
 *
 * Module scope, so it is per-warm-instance and simply empty on a cold start.
 * That is the right shape for a serverless cache: nothing is shared, nothing
 * needs invalidating, and the miss path is correct on its own.
 */
const certCache = new Map<string, CachedCert>();
const CERT_TTL_MS = 24 * 60 * 60 * 1000;
/** Bounded so a URL that varies (it should not) cannot grow the map forever. */
const CERT_CACHE_MAX = 8;

async function fetchSigningCert(url: string): Promise<string | null> {
  const hit = certCache.get(url);
  if (hit && Date.now() - hit.fetchedAt < CERT_TTL_MS) return hit.pem;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[ses-webhook] signing cert fetch failed:", res.status);
      return null;
    }
    const pem = await res.text();
    // Cheap shape check. A cached HTML error page would make every signature
    // fail, and "the certificate host served us something odd" is a much more
    // useful log line than a flood of 401s.
    if (!pem.includes("BEGIN CERTIFICATE")) {
      console.error("[ses-webhook] signing cert URL did not return a PEM");
      return null;
    }
    if (certCache.size >= CERT_CACHE_MAX) certCache.clear();
    certCache.set(url, { pem, fetchedAt: Date.now() });
    return pem;
  } catch (err) {
    console.error("[ses-webhook] signing cert fetch error:", err);
    return null;
  }
}
