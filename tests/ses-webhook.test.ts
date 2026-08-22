import { describe, it, expect } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  classifySesNotification,
  extractEmailAddress,
  isAllowedSnsUrl,
  parseSnsEnvelope,
  snsCanonicalString,
  snsDigestAlgorithm,
  topicArnAllowed,
  verifySnsSignature,
  type SnsEnvelope,
} from "../lib/ses-events";

/**
 * The SES bounce/complaint webhook, proved without AWS and without a database.
 *
 * Two things are being defended here and they fail in opposite directions:
 *
 *  1. ADMITTING a forged message. This endpoint writes into `suppressions`,
 *     the permanent "never mail this address again" block. An unauthenticated
 *     or sloppily-authenticated version is a button that silently silences any
 *     address in any workspace, and the damage looks exactly like ordinary
 *     list attrition, so nobody would notice for months.
 *  2. SUPPRESSING on the wrong signal. A Transient bounce is a full mailbox or
 *     a greylist. Blocking on it deletes legitimate subscribers permanently —
 *     `suppressions` is keyed by email and is not undone by re-importing the
 *     CSV — so one bad hour at a large ISP would shred a client's list.
 *
 * Pure only: lib/ses-events imports node:crypto and db/schema TYPES, so these
 * run with no DATABASE_URL and no network. The SQL half (applyProviderFeedback
 * in lib/suppressions.ts) is out of reach from here — see the note at the
 * bottom.
 */

// ── Fixtures ─────────────────────────────────────────────────────

const TOPIC = "arn:aws:sns:eu-west-1:123456789012:postbox-ses-feedback";
const CERT_URL =
  "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc123.pem";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicPem = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

/** Sign an envelope the way SNS does, so verification is asserted end to end. */
function sign(msg: Omit<SnsEnvelope, "Signature">): SnsEnvelope {
  const algorithm = snsDigestAlgorithm(msg.SignatureVersion);
  if (!algorithm) throw new Error("test fixture used an unknown version");
  const signature = createSign(algorithm)
    .update(snsCanonicalString({ ...msg, Signature: "" }), "utf8")
    .sign(privateKey, "base64");
  return { ...msg, Signature: signature };
}

function notification(
  message: string,
  overrides: Partial<SnsEnvelope> = {},
): SnsEnvelope {
  return sign({
    Type: "Notification",
    MessageId: "11111111-2222-3333-4444-555555555555",
    TopicArn: TOPIC,
    Message: message,
    Timestamp: "2026-08-22T09:00:00.000Z",
    SignatureVersion: "1",
    SigningCertURL: CERT_URL,
    ...overrides,
  });
}

// ── The canonical string ─────────────────────────────────────────

describe("snsCanonicalString", () => {
  it("emits the documented key order for a Notification", () => {
    const s = snsCanonicalString({
      Type: "Notification",
      MessageId: "m",
      TopicArn: "t",
      Message: "body",
      Timestamp: "ts",
      SignatureVersion: "1",
      Signature: "ignored",
      SigningCertURL: "ignored",
    });
    expect(s).toBe(
      "Message\nbody\nMessageId\nm\nTimestamp\nts\nTopicArn\nt\nType\nNotification\n",
    );
  });

  it("includes Subject only when the message actually carried one", () => {
    // SNS omits the key entirely when there is no subject. An empty
    // "Subject\n\n" line is a DIFFERENT string from the one Amazon signed, so
    // every signature would fail — and a webhook that verifies nothing looks
    // identical to one that is merely misconfigured.
    const base = {
      Type: "Notification" as const,
      MessageId: "m",
      TopicArn: "t",
      Message: "body",
      Timestamp: "ts",
      SignatureVersion: "1",
      Signature: "",
      SigningCertURL: "",
    };
    expect(snsCanonicalString(base)).not.toContain("Subject");
    expect(snsCanonicalString({ ...base, Subject: "" })).toContain(
      "Subject\n\n",
    );
    expect(snsCanonicalString({ ...base, Subject: "hi" })).toContain(
      "Subject\nhi\n",
    );
  });

  it("uses the confirmation key order, which is not the notification one", () => {
    const s = snsCanonicalString({
      Type: "SubscriptionConfirmation",
      MessageId: "m",
      TopicArn: "t",
      Message: "body",
      Timestamp: "ts",
      Token: "tok",
      SubscribeURL: "https://sns.eu-west-1.amazonaws.com/?x=1",
      SignatureVersion: "1",
      Signature: "",
      SigningCertURL: "",
    });
    expect(s).toBe(
      "Message\nbody\nMessageId\nm\nSubscribeURL\nhttps://sns.eu-west-1.amazonaws.com/?x=1\n" +
        "Timestamp\nts\nToken\ntok\nTopicArn\nt\nType\nSubscriptionConfirmation\n",
    );
    // Subject is never part of a confirmation's canonical string.
    expect(s).not.toContain("Subject");
  });
});

// ── Signature verification ───────────────────────────────────────

describe("verifySnsSignature", () => {
  it("accepts a genuine SignatureVersion 1 (SHA1withRSA) message", () => {
    const msg = notification('{"notificationType":"Bounce"}');
    expect(verifySnsSignature(msg, publicPem)).toBe(true);
  });

  it("accepts a genuine SignatureVersion 2 (SHA256withRSA) message", () => {
    const msg = notification('{"notificationType":"Bounce"}', {
      SignatureVersion: "2",
    });
    expect(verifySnsSignature(msg, publicPem)).toBe(true);
  });

  it("rejects a tampered body — the whole point of the check", () => {
    const msg = notification('{"notificationType":"Complaint"}');
    const forged = { ...msg, Message: '{"notificationType":"Bounce"}' };
    expect(verifySnsSignature(forged, publicPem)).toBe(false);
  });

  it("rejects a tampered TopicArn, Timestamp or Subject", () => {
    const msg = notification("{}", { Subject: "original" });
    expect(verifySnsSignature({ ...msg, TopicArn: "other" }, publicPem)).toBe(
      false,
    );
    expect(
      verifySnsSignature({ ...msg, Timestamp: "2030-01-01" }, publicPem),
    ).toBe(false);
    expect(verifySnsSignature({ ...msg, Subject: "swapped" }, publicPem)).toBe(
      false,
    );
    // Dropping the optional field changes the canonical string too.
    const withoutSubject = { ...msg };
    delete withoutSubject.Subject;
    expect(verifySnsSignature(withoutSubject, publicPem)).toBe(false);
  });

  it("rejects a message signed by somebody else's key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const msg = notification("{}");
    const otherPem = other.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    expect(verifySnsSignature(msg, otherPem)).toBe(false);
  });

  it("rejects an unknown SignatureVersion instead of guessing SHA1", () => {
    // Fails closed. Treating an unrecognised version as the weakest algorithm
    // is how a future SNS change silently downgrades the check.
    expect(snsDigestAlgorithm("3")).toBeNull();
    expect(snsDigestAlgorithm("")).toBeNull();
    const msg = notification("{}");
    expect(
      verifySnsSignature({ ...msg, SignatureVersion: "3" }, publicPem),
    ).toBe(false);
  });

  it("returns false rather than throwing on junk signatures or keys", () => {
    // An exception here would become a 500, a 500 is an SNS retry, and a retry
    // loop over a broken certificate is far worse than a 401.
    const msg = notification("{}");
    expect(verifySnsSignature({ ...msg, Signature: "!!!not base64" }, publicPem))
      .toBe(false);
    expect(verifySnsSignature(msg, "not a pem")).toBe(false);
  });
});

// ── URL pinning (SSRF + key substitution) ────────────────────────

describe("isAllowedSnsUrl", () => {
  it("accepts the real signing certificate URL", () => {
    expect(isAllowedSnsUrl(CERT_URL, { requirePem: true })).toBe(true);
    expect(
      isAllowedSnsUrl(
        "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-x.pem",
        { requirePem: true },
      ),
    ).toBe(true);
  });

  it("accepts a SubscribeURL, which is not a .pem", () => {
    expect(
      isAllowedSnsUrl(
        "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
      ),
    ).toBe(true);
    expect(
      isAllowedSnsUrl(
        "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription",
        { requirePem: true },
      ),
    ).toBe(false);
  });

  it("rejects the suffix trick", () => {
    // The reason this is a whole-host regex and not endsWith(".amazonaws.com").
    for (const bad of [
      "https://sns.eu-west-1.amazonaws.com.evil.io/x.pem",
      "https://amazonaws.com.evil.io/x.pem",
      "https://evil.io/sns.eu-west-1.amazonaws.com/x.pem",
      "https://notsns.eu-west-1.amazonaws.com/x.pem",
    ]) {
      expect(isAllowedSnsUrl(bad, { requirePem: true })).toBe(false);
    }
  });

  it("rejects the userinfo trick", () => {
    // Everything before the @ is credentials; the real host is evil.io. A
    // reader skims this as an AWS URL, which is exactly why it is dangerous.
    expect(
      isAllowedSnsUrl(
        "https://sns.eu-west-1.amazonaws.com@evil.io/x.pem",
        { requirePem: true },
      ),
    ).toBe(false);
  });

  it("rejects non-https and non-URLs", () => {
    for (const bad of [
      "http://sns.eu-west-1.amazonaws.com/x.pem",
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data/",
      "",
      "not a url",
      "//sns.eu-west-1.amazonaws.com/x.pem",
    ]) {
      expect(isAllowedSnsUrl(bad, { requirePem: true })).toBe(false);
    }
  });
});

describe("topicArnAllowed", () => {
  it("pins to the exact ARN, so a valid SNS signature is not enough", () => {
    // Anyone with an AWS account can create a topic, subscribe our public URL
    // to it, and publish a hand-written bounce that verifies perfectly. The
    // signature proves it came from SNS; only this proves it came from OURS.
    expect(topicArnAllowed(TOPIC, TOPIC)).toBe(true);
    expect(
      topicArnAllowed("arn:aws:sns:eu-west-1:999999999999:postbox-ses-feedback", TOPIC),
    ).toBe(false);
  });

  it("is not a prefix match", () => {
    expect(topicArnAllowed(`${TOPIC}-attacker`, TOPIC)).toBe(false);
  });

  it("fails closed on empty input", () => {
    expect(topicArnAllowed("", TOPIC)).toBe(false);
    expect(topicArnAllowed(TOPIC, "")).toBe(false);
    expect(topicArnAllowed("", "")).toBe(false);
  });

  it("supports a comma-separated list for staging", () => {
    const staging = "arn:aws:sns:eu-west-1:123456789012:postbox-ses-staging";
    expect(topicArnAllowed(staging, `${TOPIC}, ${staging}`)).toBe(true);
    expect(topicArnAllowed("arn:other", `${TOPIC}, ${staging}`)).toBe(false);
  });
});

// ── Envelope parsing ─────────────────────────────────────────────

describe("parseSnsEnvelope", () => {
  it("accepts a well-formed notification", () => {
    const msg = notification("{}");
    const parsed = parseSnsEnvelope(JSON.stringify(msg));
    expect(parsed?.Type).toBe("Notification");
    expect(parsed?.TopicArn).toBe(TOPIC);
    // Round-trips into a string that still verifies: nothing was coerced.
    expect(verifySnsSignature(parsed!, publicPem)).toBe(true);
  });

  it("rejects junk, unknown types, and missing signed fields", () => {
    expect(parseSnsEnvelope("not json")).toBeNull();
    expect(parseSnsEnvelope("null")).toBeNull();
    expect(parseSnsEnvelope(JSON.stringify({ Type: "Whatever" }))).toBeNull();
    const msg = notification("{}") as Record<string, unknown>;
    for (const field of ["MessageId", "TopicArn", "Timestamp", "Signature"]) {
      const broken = { ...msg };
      delete broken[field];
      expect(parseSnsEnvelope(JSON.stringify(broken))).toBeNull();
    }
  });

  it("requires Token and SubscribeURL on a confirmation", () => {
    const base = {
      Type: "SubscriptionConfirmation",
      MessageId: "m",
      TopicArn: TOPIC,
      Message: "body",
      Timestamp: "ts",
      SignatureVersion: "1",
      Signature: "sig",
      SigningCertURL: CERT_URL,
    };
    expect(parseSnsEnvelope(JSON.stringify(base))).toBeNull();
    expect(
      parseSnsEnvelope(
        JSON.stringify({ ...base, Token: "t", SubscribeURL: "https://x" }),
      ),
    ).not.toBeNull();
  });

  it("does not invent a Subject that was absent", () => {
    const msg = notification("{}") as Record<string, unknown>;
    const parsed = parseSnsEnvelope(JSON.stringify(msg))!;
    expect("Subject" in parsed).toBe(false);
  });

  it("reads the SigningCertUrl spelling some tooling emits", () => {
    const msg = notification("{}") as Record<string, unknown>;
    delete msg.SigningCertURL;
    msg.SigningCertUrl = CERT_URL;
    expect(parseSnsEnvelope(JSON.stringify(msg))?.SigningCertURL).toBe(CERT_URL);
  });
});

// ── The mapping that decides who gets blocked ────────────────────

function bounce(bounceType: string, recipients = ["gone@x.com"]) {
  return JSON.stringify({
    notificationType: "Bounce",
    mail: { messageId: "0100-abc", destination: recipients },
    bounce: {
      bounceType,
      bounceSubType: "General",
      bouncedRecipients: recipients.map((emailAddress) => ({
        emailAddress,
        status: "5.1.1",
        diagnosticCode: "smtp; 550 5.1.1 user unknown",
      })),
    },
  });
}

describe("classifySesNotification — Permanent suppresses, Transient must not", () => {
  it("suppresses a Permanent bounce as a hard bounce", () => {
    const f = classifySesNotification(bounce("Permanent"));
    expect(f.kind).toBe("hard_bounce");
    expect(f.messageId).toBe("0100-abc");
    expect(f.recipients).toHaveLength(1);
    expect(f.recipients[0].suppress).toBe("hard_bounce");
    expect(f.recipients[0].recipientStatus).toBe("bounced");
    expect(f.recipients[0].diagnostic).toContain("550 5.1.1 user unknown");
  });

  it("does NOT suppress a Transient bounce", () => {
    // A full mailbox is temporary. Suppressing on it destroys a list, and the
    // block is not reversed by a re-import.
    const f = classifySesNotification(bounce("Transient"));
    expect(f.kind).toBe("transient_bounce");
    expect(f.recipients[0].suppress).toBeNull();
    expect(f.recipients[0].recipientStatus).toBeNull();
    // Still carries the diagnostic, for the campaign report.
    expect(f.recipients[0].diagnostic).toBeTruthy();
  });

  it("does NOT suppress an Undetermined bounce", () => {
    // SES could not classify it. That is not permission to assume the worst.
    const f = classifySesNotification(bounce("Undetermined"));
    expect(f.kind).toBe("transient_bounce");
    expect(f.recipients[0].suppress).toBeNull();
  });

  it("treats an absent or misspelled bounceType as non-permanent", () => {
    // Fails towards keeping the subscriber. Only the exact string "Permanent"
    // is permission to block forever.
    for (const t of ["", "permanent", "PERMANENT", "Perm"]) {
      expect(classifySesNotification(bounce(t)).recipients[0].suppress).toBeNull();
    }
  });

  it("decides per recipient across a multi-recipient bounce", () => {
    const f = classifySesNotification(
      bounce("Permanent", ["a@x.com", "b@x.com"]),
    );
    expect(f.recipients.map((r) => r.email)).toEqual(["a@x.com", "b@x.com"]);
    expect(f.recipients.every((r) => r.suppress === "hard_bounce")).toBe(true);
  });
});

describe("classifySesNotification — complaints", () => {
  it("suppresses immediately and records the feedback type", () => {
    const f = classifySesNotification(
      JSON.stringify({
        notificationType: "Complaint",
        mail: { messageId: "0100-xyz" },
        complaint: {
          complainedRecipients: [{ emailAddress: "Angry <ANGRY@X.com>" }],
          complaintFeedbackType: "abuse",
        },
      }),
    );
    expect(f.kind).toBe("complaint");
    expect(f.messageId).toBe("0100-xyz");
    expect(f.recipients[0].suppress).toBe("complaint");
    expect(f.recipients[0].recipientStatus).toBe("complained");
    // Normalised on the way in: the suppression index is matched on
    // lower(btrim(email)), and a display name would never match anything.
    expect(f.recipients[0].email).toBe("angry@x.com");
    expect(f.recipients[0].diagnostic).toContain("abuse");
  });

  it("suppresses even when the feedback type is missing", () => {
    const f = classifySesNotification(
      JSON.stringify({
        notificationType: "Complaint",
        mail: { messageId: "m" },
        complaint: { complainedRecipients: [{ emailAddress: "a@x.com" }] },
      }),
    );
    expect(f.recipients[0].suppress).toBe("complaint");
  });
});

describe("classifySesNotification — everything else", () => {
  it("ignores non-feedback event types without inventing recipients", () => {
    for (const eventType of [
      "Delivery",
      "Send",
      "Open",
      "Click",
      "DeliveryDelay",
      "Reject",
    ]) {
      const f = classifySesNotification(
        JSON.stringify({ eventType, mail: { messageId: "m" } }),
      );
      expect(f.kind).toBe("other");
      expect(f.recipients).toEqual([]);
    }
  });

  it("reads the configuration-set `eventType` spelling as well as `notificationType`", () => {
    // Feedback notifications say notificationType; configuration-set event
    // publishing to the same topic says eventType. Both reach this endpoint.
    const f = classifySesNotification(
      JSON.stringify({
        eventType: "Bounce",
        mail: { messageId: "m" },
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "a@x.com" }],
        },
      }),
    );
    expect(f.kind).toBe("hard_bounce");
    expect(f.recipients[0].suppress).toBe("hard_bounce");
  });

  it("never throws, and never suppresses, on a malformed payload", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      "{}",
      '{"notificationType":"Bounce"}',
      '{"notificationType":"Bounce","bounce":{"bounceType":"Permanent"}}',
      '{"notificationType":"Complaint","complaint":{}}',
    ]) {
      const f = classifySesNotification(raw);
      expect(f.recipients.some((r) => r.suppress)).toBe(false);
    }
  });

  it("drops recipients with no address rather than blocking an empty string", () => {
    const f = classifySesNotification(
      JSON.stringify({
        notificationType: "Bounce",
        mail: { messageId: "m" },
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{}, { emailAddress: "" }, { emailAddress: "a@x.com" }],
        },
      }),
    );
    expect(f.recipients.map((r) => r.email)).toEqual(["a@x.com"]);
  });

  it("reports no messageId when SES did not give one", () => {
    // The route drops these: without it there is no way to attribute the
    // bounce to a workspace, and the only alternatives are guessing a tenant
    // or suppressing globally.
    const f = classifySesNotification(
      JSON.stringify({
        notificationType: "Complaint",
        complaint: { complainedRecipients: [{ emailAddress: "a@x.com" }] },
      }),
    );
    expect(f.messageId).toBeNull();
  });
});

describe("extractEmailAddress", () => {
  it("strips a display name and folds case", () => {
    expect(extractEmailAddress("Bob Smith <Bob@Example.COM>")).toBe(
      "bob@example.com",
    );
    expect(extractEmailAddress("  bob@example.com ")).toBe("bob@example.com");
  });

  it("does not fold plus-tags into a different mailbox", () => {
    // Blocking bob@ because bob+news@ bounced silences a mailbox that never
    // bounced. Matches normaliseEmail in lib/newsletter.ts.
    expect(extractEmailAddress("bob+news@x.com")).toBe("bob+news@x.com");
  });

  it("returns empty for junk instead of a truthy near-miss", () => {
    expect(extractEmailAddress(undefined)).toBe("");
    expect(extractEmailAddress(null)).toBe("");
    expect(extractEmailAddress(42)).toBe("");
  });
});

/*
 * NOT COVERED HERE, and deliberately so:
 *
 *  - applyProviderFeedback / noteProviderFeedback in lib/suppressions.ts. They
 *    are the actual writes — the workspace resolution through
 *    campaign_recipients.provider_message_id, the ON CONFLICT DO NOTHING that
 *    makes SNS redelivery a no-op, and the 'subscribed'-only status update.
 *    They are SQL, and reaching them needs a DATABASE_URL, which CI does not
 *    have and must not need.
 *  - The route's fail-closed behaviour when SES_SNS_TOPIC_ARN is unset, and the
 *    signing-certificate cache. Both need a request and a network.
 */
