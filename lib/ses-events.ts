import { createVerify } from "node:crypto";
import type { SuppressionReason } from "@/db/schema";

/**
 * SNS envelope verification and SES feedback parsing — the PURE half of the
 * bounce/complaint webhook.
 *
 * Nothing here touches the database, the network or `process.env`. Same reason
 * as lib/newsletter.ts and lib/campaign-cron.ts: `db/index.ts` throws at import
 * time when DATABASE_URL is unset and CI has no database, so the only way the
 * signature check and the Permanent-vs-Transient mapping get *asserted on*
 * rather than merely reasoned about is for them to live in a module a test can
 * import. The IO half — fetching the signing certificate, confirming the
 * subscription, writing the suppression — is in
 * app/api/webhooks/ses/route.ts and lib/suppressions.ts.
 *
 * ── WHY THE SIGNATURE CHECK IS NOT OPTIONAL ──
 *
 * This endpoint writes into `suppressions`, which is the durable "never mail
 * this address again" block (see lib/suppressions.ts). An unauthenticated
 * version of it is a button that permanently silences any address in any
 * workspace — a denial-of-service against a client's mailing list that looks
 * exactly like normal deliverability attrition, so nobody would notice for
 * months. The URL is public (proxy.ts lists `/api/(.*)` as public, so Clerk
 * does not guard it) and it is not secret: it sits in the SNS console.
 *
 * ── THE SIGNATURE ALONE IS NOT ENOUGH ──
 *
 * A valid SNS signature proves the message came from Amazon SNS. It does NOT
 * prove it came from *our* topic: anybody with an AWS account can create a
 * topic, subscribe our URL to it, and publish a hand-written "bounce" that
 * verifies perfectly. `topicArnAllowed` is therefore as load-bearing as
 * `verifySnsSignature`, and the route refuses everything when the expected ARN
 * is not configured.
 */

// ── The SNS envelope ─────────────────────────────────────────────

export type SnsMessageType =
  | "Notification"
  | "SubscriptionConfirmation"
  | "UnsubscribeConfirmation";

export type SnsEnvelope = {
  Type: SnsMessageType;
  MessageId: string;
  TopicArn: string;
  /** The SES payload, as a JSON *string*. Signed as-is; never re-serialise it. */
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  /** Notifications only, and only when the publisher set one. */
  Subject?: string;
  /** Confirmations only. */
  Token?: string;
  SubscribeURL?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parse and shape-check the SNS envelope.
 *
 * Returns null rather than throwing, and never repairs anything: the canonical
 * string is rebuilt from these exact fields, so a value coerced here (a number
 * read as a string, a missing field defaulted to "") would be a value that was
 * never signed. Coercion at this boundary is how signature checks are quietly
 * turned off.
 *
 * `SigningCertURL` is accepted under either spelling. AWS documents
 * `SigningCertURL`, but older tooling and some SDK fixtures emit
 * `SigningCertUrl`; the field is not part of the canonical string, so reading
 * both is safe.
 */
export function parseSnsEnvelope(raw: string): SnsEnvelope | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const type = str(payload.Type);
  if (
    type !== "Notification" &&
    type !== "SubscriptionConfirmation" &&
    type !== "UnsubscribeConfirmation"
  ) {
    return null;
  }

  const env: SnsEnvelope = {
    Type: type,
    MessageId: str(payload.MessageId),
    TopicArn: str(payload.TopicArn),
    Message: str(payload.Message),
    Timestamp: str(payload.Timestamp),
    SignatureVersion: str(payload.SignatureVersion),
    Signature: str(payload.Signature),
    SigningCertURL:
      str(payload.SigningCertURL) || str(payload.SigningCertUrl),
  };

  if (typeof payload.Subject === "string") env.Subject = payload.Subject;
  if (typeof payload.Token === "string") env.Token = payload.Token;
  if (typeof payload.SubscribeURL === "string") {
    env.SubscribeURL = payload.SubscribeURL;
  }

  // Every field that goes into the canonical string must actually be present.
  if (
    !env.MessageId ||
    !env.TopicArn ||
    !env.Timestamp ||
    !env.Signature ||
    !env.SigningCertURL
  ) {
    return null;
  }
  if (type !== "Notification" && (!env.Token || !env.SubscribeURL)) return null;

  return env;
}

/**
 * Rebuild the string Amazon signed.
 *
 * The format is `key\nvalue\n` repeated, with the keys in a FIXED order that
 * differs per message type, and `Subject` included only when the notification
 * actually carried one. Getting the order or the optionality wrong does not
 * produce a warning — it produces a signature that never verifies, which is
 * indistinguishable from an attack and is the reason this is a separate,
 * directly-tested function rather than inline in the route.
 */
export function snsCanonicalString(msg: SnsEnvelope): string {
  const parts: string[] = [];
  const add = (key: string, value: string) => {
    parts.push(key, "\n", value, "\n");
  };

  if (msg.Type === "Notification") {
    add("Message", msg.Message);
    add("MessageId", msg.MessageId);
    // Present-or-absent, never empty-string-as-absent: SNS omits the key
    // entirely when there is no subject, and an empty Subject line would be a
    // different string from the one that was signed.
    if (msg.Subject !== undefined) add("Subject", msg.Subject);
    add("Timestamp", msg.Timestamp);
    add("TopicArn", msg.TopicArn);
    add("Type", msg.Type);
  } else {
    add("Message", msg.Message);
    add("MessageId", msg.MessageId);
    add("SubscribeURL", msg.SubscribeURL ?? "");
    add("Timestamp", msg.Timestamp);
    add("Token", msg.Token ?? "");
    add("TopicArn", msg.TopicArn);
    add("Type", msg.Type);
  }

  return parts.join("");
}

/**
 * SignatureVersion 1 is SHA1withRSA, version 2 is SHA256withRSA.
 *
 * Anything else returns null and the message is refused. Treating an unknown
 * version as "probably SHA1" would let a future SNS change silently downgrade
 * the check, and there is no cost to failing closed — SNS retries, and a
 * genuine version bump is a two-line change here.
 */
export function snsDigestAlgorithm(
  version: string,
): "RSA-SHA1" | "RSA-SHA256" | null {
  if (version === "1") return "RSA-SHA1";
  if (version === "2") return "RSA-SHA256";
  return null;
}

/**
 * Verify the RSA signature over the canonical string.
 *
 * `key` is the PEM Amazon publishes at `SigningCertURL` — an X.509
 * certificate, which node's verifier accepts directly (a bare public key PEM
 * works too, which is what the tests use, since minting a self-signed
 * certificate in a unit test proves nothing this function does).
 *
 * No timing-safe comparison is needed or possible here: RSA verification is
 * not a byte comparison against a secret, and there is no secret on our side
 * to leak. `verify` returns false on malformed base64 rather than throwing,
 * but the try/catch covers a malformed *key* too — an error reaching the route
 * would become a 500, and a 500 is a retry, and a retry loop over a broken
 * certificate is a much worse day than a 401.
 */
export function verifySnsSignature(msg: SnsEnvelope, key: string): boolean {
  const algorithm = snsDigestAlgorithm(msg.SignatureVersion);
  if (!algorithm) return false;
  try {
    return createVerify(algorithm)
      .update(snsCanonicalString(msg), "utf8")
      .verify(key, msg.Signature, "base64");
  } catch {
    return false;
  }
}

/**
 * Is this a URL we are willing to make an outbound request to?
 *
 * Applied to `SigningCertURL` and to `SubscribeURL`, and both matter:
 *
 *  • The certificate URL decides WHICH KEY the signature is checked against.
 *    An attacker who can point it at their own host signs their own payload
 *    with their own key and the check passes with flying colours. Validating
 *    the host is what makes the signature mean anything at all.
 *  • `SubscribeURL` is fetched by the confirmation step. Fetching an
 *    attacker-supplied URL from inside our own network is a textbook SSRF —
 *    on a serverless platform that is a metadata-endpoint or internal-service
 *    probe with our credentials attached.
 *
 * The rule is a whole-host match against `sns.<region>.amazonaws.com`, not a
 * substring or `endsWith` test. `endsWith(".amazonaws.com")` alone still lets
 * through nothing useful, but the near-miss forms it *would* let through if
 * written slightly differently are the whole attack surface:
 * `amazonaws.com.evil.io`, `sns.eu-west-1.amazonaws.com.evil.io`, and
 * `https://sns.eu-west-1.amazonaws.com@evil.io/x.pem` — where everything
 * before the `@` is userinfo and the real host is `evil.io`. WHATWG URL
 * parsing puts the real host in `hostname` for all three, so comparing that
 * one field against a full pattern defeats all of them.
 *
 * https only, and the path must end in `.pem` for a certificate URL — an open
 * redirect on a genuine AWS host is still an SSRF.
 */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i;

export function isAllowedSnsUrl(
  raw: string,
  opts: { requirePem?: boolean } = {},
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Userinfo is stripped into these fields by the parser; a URL that carries
  // any is not a shape AWS ever emits, so refuse it rather than reason about it.
  if (url.username || url.password) return false;
  if (!SNS_HOST.test(url.hostname)) return false;
  if (opts.requirePem && !url.pathname.toLowerCase().endsWith(".pem")) {
    return false;
  }
  return true;
}

/**
 * Does this message come from the topic we were told to trust?
 *
 * Exact string equality on the full ARN. Not a prefix match: ARNs end in the
 * topic name, and `arn:aws:sns:eu-west-1:111:postbox-ses-feedback` is a prefix
 * of `...postbox-ses-feedback-attacker`. The account id is in the middle of
 * the ARN, so exact equality also pins the account.
 *
 * A comma-separated list is accepted so a staging topic can be added without a
 * code change.
 */
export function topicArnAllowed(arn: string, allowed: string): boolean {
  if (!arn || !allowed) return false;
  return allowed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(arn);
}

// ── The SES payload ──────────────────────────────────────────────

/** Diagnostics are attacker-adjacent free text; cap before it reaches storage. */
export const SES_DIAGNOSTIC_MAX = 400;

export type SesRecipientDecision = {
  /** Lower-cased, trimmed, display name stripped. */
  email: string;
  /**
   * The block to write, or null for "log this and write no block".
   * Null is the correct answer for a Transient bounce and it is not a
   * degenerate case — see `classifySesNotification`.
   */
  suppress: SuppressionReason | null;
  /** The `campaign_recipients.status` this implies, or null to leave it alone. */
  recipientStatus: "bounced" | "complained" | null;
  /** Provider diagnostic, capped. Stored in the suppression note / recipient error. */
  diagnostic: string | null;
};

export type SesFeedbackKind =
  | "hard_bounce"
  | "transient_bounce"
  | "complaint"
  | "other";

export type SesFeedback = {
  /** "Bounce" | "Complaint" | "Delivery" | "Send" | … as SES labelled it. */
  eventType: string;
  kind: SesFeedbackKind;
  /**
   * The SES MessageId. This is the join key back to
   * `campaign_recipients.provider_message_id`, which is the ONLY thing that
   * tells us which workspace a bounce belongs to — the webhook is global and
   * suppressions are workspace-scoped. Null means unmappable, and an
   * unmappable bounce must be logged and dropped, never suppressed globally.
   */
  messageId: string | null;
  recipients: SesRecipientDecision[];
  /** One line for the log. */
  summary: string;
};

function cap(s: string): string | null {
  const v = s.replace(/\s+/g, " ").trim().slice(0, SES_DIAGNOSTIC_MAX);
  return v || null;
}

/** SES usually sends a bare address but may send `Name <a@b.com>`. */
export function extractEmailAddress(raw: unknown): string {
  const s = str(raw).trim();
  const angled = s.match(/<([^>]+)>/);
  return (angled ? angled[1] : s).trim().toLowerCase();
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Turn one SES notification into per-recipient decisions.
 *
 * ── PERMANENT vs TRANSIENT IS THE WHOLE POINT ──
 *
 * `bounceType: "Permanent"` means the mailbox does not exist. It is a hard
 * bounce, it counts against the account's bounce rate at Amazon, and it must
 * produce a durable block or the same address is mailed again next campaign
 * and the rate never recovers.
 *
 * `bounceType: "Transient"` means a full mailbox, a greylist, a temporary
 * server failure. It is NOT evidence the address is bad, and suppressing on it
 * permanently deletes legitimate subscribers — a large ISP having a bad hour
 * would silently shred a chunk of a client's list, and `suppressions` is not
 * un-done by re-importing the CSV. Transient bounces are logged and nothing
 * more. `"Undetermined"` gets the same treatment for the same reason: it means
 * SES could not classify it, which is not permission to assume the worst.
 *
 * ── COMPLAINTS ──
 *
 * A complaint is someone pressing "report spam". It is the single most
 * damaging signal to a sending reputation and there is no soft version of it:
 * suppress immediately, permanently, and never re-add on import. Note that
 * Gmail does not report complaints to SES at all (docs/NEWSLETTER.md §6), so
 * absence of complaints here is not evidence of their absence in reality.
 *
 * Anything else — Delivery, Send, Open, Click, DeliveryDelay — is classified
 * `other` with no recipients, so the route acknowledges and does nothing.
 * A DeliveryDelay in particular looks alarming and is explicitly not a bounce.
 */
export function classifySesNotification(messageJson: string): SesFeedback {
  let payload: Record<string, unknown>;
  try {
    payload = obj(JSON.parse(messageJson));
  } catch {
    return {
      eventType: "Unparseable",
      kind: "other",
      messageId: null,
      recipients: [],
      summary: "SES message body was not JSON",
    };
  }

  // Feedback notifications use `notificationType`; configuration-set event
  // publishing to the same topic uses `eventType`. Both shapes arrive on a
  // real deployment and they are otherwise identical, so read either.
  const eventType =
    str(payload.notificationType) || str(payload.eventType) || "Unknown";

  const mail = obj(payload.mail);
  const messageId = str(mail.messageId).trim() || null;

  if (eventType === "Bounce") {
    const bounce = obj(payload.bounce);
    const bounceType = str(bounce.bounceType);
    const bounceSubType = str(bounce.bounceSubType);
    const permanent = bounceType === "Permanent";

    const recipients: SesRecipientDecision[] = arr(bounce.bouncedRecipients)
      .map((r): SesRecipientDecision | null => {
        const rec = obj(r);
        const email = extractEmailAddress(rec.emailAddress);
        if (!email) return null;
        const diagnostic = cap(
          [
            `${bounceType || "Bounce"}/${bounceSubType || "Unknown"}`,
            str(rec.status),
            str(rec.diagnosticCode),
          ]
            .filter(Boolean)
            .join(" "),
        );
        return {
          email,
          suppress: permanent ? ("hard_bounce" as SuppressionReason) : null,
          recipientStatus: permanent ? ("bounced" as const) : null,
          diagnostic,
        };
      })
      .filter((r): r is SesRecipientDecision => r !== null);

    return {
      eventType,
      kind: permanent ? "hard_bounce" : "transient_bounce",
      messageId,
      recipients,
      summary: permanent
        ? `Permanent bounce (${bounceSubType || "General"}) for ${recipients.length} recipient(s)`
        : `${bounceType || "Non-permanent"} bounce (${bounceSubType || "General"}) — logged, NOT suppressed`,
    };
  }

  if (eventType === "Complaint") {
    const complaint = obj(payload.complaint);
    const feedbackType = str(complaint.complaintFeedbackType) || "unspecified";

    const recipients: SesRecipientDecision[] = arr(
      complaint.complainedRecipients,
    )
      .map((r): SesRecipientDecision | null => {
        const email = extractEmailAddress(obj(r).emailAddress);
        if (!email) return null;
        return {
          email,
          suppress: "complaint" as SuppressionReason,
          recipientStatus: "complained" as const,
          diagnostic: cap(`Complaint (${feedbackType})`),
        };
      })
      .filter((r): r is SesRecipientDecision => r !== null);

    return {
      eventType,
      kind: "complaint",
      messageId,
      recipients,
      summary: `Complaint (${feedbackType}) for ${recipients.length} recipient(s)`,
    };
  }

  return {
    eventType,
    kind: "other",
    messageId,
    recipients: [],
    summary: `Ignored SES event type "${eventType}"`,
  };
}
