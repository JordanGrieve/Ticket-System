import { describe, it, expect } from "vitest";
import {
  buildRawMessage,
  buildSesSendRequest,
  classifySesError,
  createSesDeliverer,
  encodeHeaderValue,
  extractAwsError,
  isRetryableFailure,
  rfc5322Date,
  sanitiseHeaderValue,
  SES_SEND_PATH,
  sesEndpoint,
  signSesRequest,
  SesDeliveryError,
  type DeliveryFailureKind,
} from "../lib/deliver-ses";
import { listUnsubscribeHeaders } from "../lib/newsletter";
import type { OutboundCampaignEmail } from "../lib/campaign-send";

/**
 * The SES adapter's pure parts.
 *
 * No network and no DATABASE_URL. Every test that exercises the deliverer
 * itself passes a fake `fetch`, so the suite cannot reach AWS even if
 * credentials happen to be in the ambient environment — and the credentials
 * used below are AWS's own documentation examples.
 *
 * The two things worth proving here are the two that cannot be discovered
 * safely in production: that the RFC 8058 headers reach the wire verbatim, and
 * that a throttle and a hard bounce are never confused for one another.
 */

const CREDENTIALS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

const AT = new Date("2026-08-18T09:30:00.000Z");

function outbound(
  overrides: Partial<OutboundCampaignEmail> = {},
): OutboundCampaignEmail {
  return {
    to: "sam@example.com",
    from: "Acme <news@news.postbox.help>",
    subject: "August news",
    text: "Hello there.\n\nUnsubscribe: https://postbox.help/u/TOKEN",
    html: "<p>Hello there.</p>",
    headers: listUnsubscribeHeaders({
      url: "https://postbox.help/u/TOKEN",
      mailto: "unsubscribe@postbox.help",
    }),
    ...overrides,
  };
}

// ── Error classification ─────────────────────────────────────────

describe("classifySesError — a throttle and a hard bounce are not the same failure", () => {
  it("classifies rate limiting as retryable", () => {
    const throttles: { statusCode?: number; code?: string; message?: string }[] =
      [
        { statusCode: 429, code: "TooManyRequestsException" },
        { statusCode: 400, code: "Throttling", message: "Rate exceeded" },
        { statusCode: 400, code: "ThrottlingException" },
        { statusCode: 400, code: "LimitExceededException" },
        { statusCode: 429 },
        {
          statusCode: 400,
          code: "MessageRejected",
          message: "Maximum sending rate exceeded.",
        },
      ];
    for (const t of throttles) {
      expect(classifySesError(t)).toBe("throttled");
      expect(isRetryableFailure(classifySesError(t))).toBe(true);
    }
  });

  it("classifies a suppressed destination as PERMANENT and never retryable", () => {
    // Retrying this is the offence: SES is telling us the address previously
    // hard-bounced or complained. A retry sweep that treated it like a throttle
    // would keep mailing it forever, on a domain every other tenant shares.
    const suppressed = [
      { statusCode: 400, code: "SuppressedDestination" },
      {
        statusCode: 400,
        code: "MessageRejected",
        message: "Recipient address is on the suppression list for your account",
      },
      // Even wearing a 429's clothing, the message wins.
      {
        statusCode: 429,
        code: null,
        message: "Address suppressed: on the suppression list",
      },
    ];
    for (const s of suppressed) {
      expect(classifySesError(s)).toBe("suppressed");
      expect(isRetryableFailure("suppressed")).toBe(false);
    }
  });

  it("classifies a rejected or unverified send as permanent", () => {
    const permanent = [
      { statusCode: 400, code: "MessageRejected", message: "Email address is not verified" },
      { statusCode: 400, code: "MailFromDomainNotVerifiedException" },
      { statusCode: 400, code: "BadRequestException" },
      { statusCode: 403, code: "AccessDeniedException" },
      { statusCode: 403, code: "SignatureDoesNotMatch" },
      { statusCode: 404, code: "NotFoundException" },
      { statusCode: 400 },
    ];
    for (const p of permanent) {
      expect(classifySesError(p)).toBe("permanent");
      expect(isRetryableFailure("permanent")).toBe(false);
    }
  });

  it("classifies an account or tenant pause as its own kind, and not retryable", () => {
    // Not `permanent` (the recipient did nothing wrong) and not retryable
    // (every attempt is more evidence for the reputation policy that paused us).
    for (const p of [
      { statusCode: 400, code: "AccountSuspendedException" },
      { statusCode: 400, code: "SendingPausedException" },
      { statusCode: 400, message: "Sending paused for this account" },
    ]) {
      expect(classifySesError(p)).toBe("paused");
    }
    expect(isRetryableFailure("paused")).toBe(false);
  });

  it("classifies 5xx and answerless requests as transient", () => {
    expect(classifySesError({ statusCode: 500 })).toBe("transient");
    expect(classifySesError({ statusCode: 503 })).toBe("transient");
    // No status at all: DNS, TLS, socket, abort.
    expect(classifySesError({})).toBe("transient");
  });

  it("unwraps namespaced and suffixed AWS type strings", () => {
    expect(
      classifySesError({
        statusCode: 400,
        code: "com.amazonaws.sesv2#TooManyRequestsException",
      }),
    ).toBe("throttled");
    expect(
      classifySesError({ statusCode: 400, code: "Throttling: Rate exceeded" }),
    ).toBe("throttled");
  });

  it("is total — it returns a kind for anything, and never throws", () => {
    const inputs = [
      {},
      { statusCode: 0 },
      { statusCode: 200 },
      { code: "" },
      { code: "###" },
      { message: "" },
      { statusCode: 418, code: "Teapot", message: "short and stout" },
    ];
    const kinds: DeliveryFailureKind[] = [];
    for (const i of inputs) {
      expect(() => kinds.push(classifySesError(i))).not.toThrow();
    }
    expect(kinds).toHaveLength(inputs.length);
  });

  it("only ever marks two kinds retryable — the allowlist, not a denylist", () => {
    const all: DeliveryFailureKind[] = [
      "throttled",
      "transient",
      "paused",
      "suppressed",
      "permanent",
    ];
    expect(all.filter(isRetryableFailure)).toEqual(["throttled", "transient"]);
  });
});

describe("SesDeliveryError", () => {
  it("puts the kind in the message, which is what lands in campaign_recipients.error", () => {
    const err = new SesDeliveryError({
      kind: "suppressed",
      message: "on the suppression list",
      statusCode: 400,
      awsCode: "SuppressedDestination",
      recipient: "sam@example.com",
    });
    expect(err.message).toBe("[suppressed] on the suppression list");
    expect(err.retryable).toBe(false);
    expect(err.kind).toBe("suppressed");
    expect(err instanceof Error).toBe(true);
  });
});

describe("extractAwsError", () => {
  it("prefers the x-amzn-errortype header", () => {
    const { code } = extractAwsError(
      400,
      "TooManyRequestsException",
      '{"message":"Rate exceeded"}',
    );
    expect(code).toBe("TooManyRequestsException");
  });

  it("falls back to __type in the body", () => {
    const { code, message } = extractAwsError(
      400,
      null,
      '{"__type":"MessageRejected","message":"Email address is not verified"}',
    );
    expect(code).toBe("MessageRejected");
    expect(message).toBe("Email address is not verified");
  });

  it("survives a non-JSON body from a proxy", () => {
    const { code, message } = extractAwsError(502, null, "<html>Bad Gateway</html>");
    expect(code).toBeNull();
    expect(message).toContain("Bad Gateway");
  });
});

// ── MIME ─────────────────────────────────────────────────────────

describe("buildRawMessage", () => {
  const raw = () => buildRawMessage(outbound(), { token: "TOK", at: AT });

  it("puts the List-Unsubscribe headers on the wire verbatim", () => {
    const message = raw();
    expect(message).toContain(
      "List-Unsubscribe: <mailto:unsubscribe@postbox.help>, <https://postbox.help/u/TOKEN>\r\n",
    );
    expect(message).toContain(
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
    );
  });

  it("builds those headers from lib/newsletter, not from a second implementation", () => {
    // If listUnsubscribeHeaders ever changes shape, this fails here rather than
    // silently diverging on the wire.
    const headers = listUnsubscribeHeaders({
      url: "https://postbox.help/u/ABC",
      mailto: null,
    });
    const message = buildRawMessage(outbound({ headers }), {
      token: "TOK",
      at: AT,
    });
    expect(message).toContain("List-Unsubscribe: <https://postbox.help/u/ABC>");
    expect(message).not.toContain("mailto:");
  });

  it("uses multipart/alternative with text FIRST and html SECOND", () => {
    const message = raw();
    const textPart = message.indexOf('Content-Type: text/plain; charset="UTF-8"');
    const htmlPart = message.indexOf('Content-Type: text/html; charset="UTF-8"');
    expect(textPart).toBeGreaterThan(-1);
    expect(htmlPart).toBeGreaterThan(textPart);
    expect(message).toContain("Content-Type: multipart/alternative; boundary=");
  });

  it("base64-encodes both parts so UTF-8 and long lines cannot corrupt them", () => {
    const message = buildRawMessage(
      outbound({ text: "Grüße — £5", html: "<p>Grüße — £5</p>" }),
      { token: "TOK", at: AT },
    );
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(message).toContain(Buffer.from("Grüße — £5", "utf8").toString("base64"));
  });

  it("uses CRLF line endings and closes the boundary", () => {
    const message = raw();
    expect(message).toContain("\r\n");
    expect(message.trimEnd().endsWith("--")).toBe(true);
  });

  it("is deterministic for fixed inputs", () => {
    expect(raw()).toBe(raw());
  });

  it("REFUSES a caller header that would rewrite the envelope", () => {
    // A Bcc smuggled through `headers` would send a silent copy of every
    // recipient's personalised message somewhere else.
    const message = buildRawMessage(
      outbound({
        headers: {
          Bcc: "attacker@evil.test",
          To: "attacker@evil.test",
          "Content-Type": "text/plain",
          "X-Campaign-Id": "42",
        },
      }),
      { token: "TOK", at: AT },
    );
    expect(message).not.toContain("attacker@evil.test");
    expect(message).toContain("To: sam@example.com");
    expect(message).toContain("X-Campaign-Id: 42");
    // Exactly one Content-Type at the top level — the multipart one we set.
    expect(message.match(/^Content-Type: /gm)?.length).toBe(3);
  });

  it("neutralises CRLF injection in the subject", () => {
    const message = buildRawMessage(
      outbound({ subject: "Hi\r\nBcc: attacker@evil.test" }),
      { token: "TOK", at: AT },
    );
    // The text survives — as the SUBJECT, folded onto one line. What must not
    // exist is a line that BEGINS "Bcc:", which is what a real header is.
    expect(message).not.toMatch(/^Bcc:/m);
    expect(message).toContain("Subject: Hi Bcc: attacker@evil.test");
  });

  it("drops a header whose NAME is not a header name", () => {
    const message = buildRawMessage(
      outbound({ headers: { "X-Bad\r\nBcc": "attacker@evil.test" } }),
      { token: "TOK", at: AT },
    );
    expect(message).not.toContain("attacker@evil.test");
  });

  it("derives the Message-ID domain from the From address", () => {
    expect(raw()).toContain("Message-ID: <TOK@news.postbox.help>");
  });
});

describe("header encoding", () => {
  it("leaves plain ASCII alone", () => {
    expect(encodeHeaderValue("August news")).toBe("August news");
  });

  it("RFC 2047 encodes anything else", () => {
    expect(encodeHeaderValue("Grüße")).toBe(
      `=?UTF-8?B?${Buffer.from("Grüße", "utf8").toString("base64")}?=`,
    );
  });

  it("strips CR and LF before anything else happens", () => {
    expect(sanitiseHeaderValue("a\r\nb")).toBe("a b");
    expect(encodeHeaderValue("a\nBcc: x@y")).not.toContain("\n");
  });

  it("emits an RFC 5322 numeric offset, not 'GMT'", () => {
    expect(rfc5322Date(AT)).toBe("Tue, 18 Aug 2026 09:30:00 +0000");
  });
});

// ── The request ──────────────────────────────────────────────────

describe("buildSesSendRequest", () => {
  it("sends to exactly ONE recipient per call", () => {
    // Batching would hand every recipient the same per-recipient unsubscribe
    // token, and would make the returned MessageId map to N recipient rows.
    const body = buildSesSendRequest({ email: outbound(), raw: "RAW" });
    expect(body.Destination.ToAddresses).toEqual(["sam@example.com"]);
  });

  it("omits the optional identifiers rather than sending empty strings", () => {
    const body = buildSesSendRequest({ email: outbound(), raw: "RAW" });
    expect(body.ConfigurationSetName).toBeUndefined();
    expect(body.TenantName).toBeUndefined();
    expect(body.FeedbackForwardingEmailAddress).toBeUndefined();
  });

  it("carries the configuration set, the tenant and the return path when given", () => {
    const body = buildSesSendRequest({
      email: outbound(),
      raw: "RAW",
      configurationSetName: "postbox-campaigns",
      tenantName: "workspace-17",
      returnPath: "bounces@news.postbox.help",
    });
    expect(body.ConfigurationSetName).toBe("postbox-campaigns");
    expect(body.TenantName).toBe("workspace-17");
    expect(body.FeedbackForwardingEmailAddress).toBe(
      "bounces@news.postbox.help",
    );
  });

  it("base64s the raw message", () => {
    const body = buildSesSendRequest({ email: outbound(), raw: "RAW" });
    expect(body.Content.Raw.Data).toBe(Buffer.from("RAW", "utf8").toString("base64"));
  });
});

describe("signSesRequest", () => {
  const signed = () =>
    signSesRequest({
      method: "POST",
      endpoint: sesEndpoint("eu-west-1"),
      path: SES_SEND_PATH,
      region: "eu-west-1",
      body: '{"a":1}',
      credentials: CREDENTIALS,
      at: AT,
    });

  it("produces a SigV4 Authorization header scoped to the region and service", () => {
    const { headers } = signed();
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260818\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("is deterministic for a fixed clock, and changes with the body", () => {
    expect(signed().headers.authorization).toBe(signed().headers.authorization);
    const other = signSesRequest({
      method: "POST",
      endpoint: sesEndpoint("eu-west-1"),
      path: SES_SEND_PATH,
      region: "eu-west-1",
      body: '{"a":2}',
      credentials: CREDENTIALS,
      at: AT,
    });
    expect(other.headers.authorization).not.toBe(signed().headers.authorization);
  });

  it("signs the session token when one is present", () => {
    const { headers } = signSesRequest({
      method: "POST",
      endpoint: sesEndpoint("us-east-1"),
      path: SES_SEND_PATH,
      region: "us-east-1",
      body: "{}",
      credentials: { ...CREDENTIALS, sessionToken: "TOKEN" },
      at: AT,
    });
    expect(headers["x-amz-security-token"]).toBe("TOKEN");
    expect(headers.authorization).toContain("x-amz-security-token");
  });

  it("targets the regional endpoint", () => {
    expect(signed().url).toBe(
      "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails",
    );
  });

  it("never puts the secret key in the output", () => {
    expect(JSON.stringify(signed())).not.toContain(CREDENTIALS.secretAccessKey);
  });
});

// ── The deliverer, against a fake fetch ──────────────────────────

function deliverer(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createSesDeliverer>[0]> = {},
) {
  return createSesDeliverer({
    region: "eu-west-1",
    credentials: CREDENTIALS,
    fetchImpl,
    now: () => AT,
    tokenFactory: () => "TOK",
    ...overrides,
  });
}

describe("createSesDeliverer", () => {
  it("POSTs a signed raw send and returns the SES MessageId", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ MessageId: "0100018-abc" }), {
        status: 200,
      });
    };

    const result = await deliverer(fake, {
      configurationSetName: "postbox-campaigns",
      tenantName: "workspace-17",
    })(outbound());

    expect(result.id).toBe("0100018-abc");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails",
    );

    const body = JSON.parse(String(calls[0].init.body)) as {
      Destination: { ToAddresses: string[] };
      TenantName: string;
      ConfigurationSetName: string;
      Content: { Raw: { Data: string } };
    };
    expect(body.Destination.ToAddresses).toEqual(["sam@example.com"]);
    expect(body.TenantName).toBe("workspace-17");
    expect(body.ConfigurationSetName).toBe("postbox-campaigns");

    // The one assertion that matters most: the unsubscribe headers survived
    // all the way to the bytes AWS would receive.
    const mime = Buffer.from(body.Content.Raw.Data, "base64").toString("utf8");
    expect(mime).toContain("List-Unsubscribe:");
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });

  it("throws a classified error on a throttle", async () => {
    const fake: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Rate exceeded" }), {
        status: 429,
        headers: { "x-amzn-errortype": "TooManyRequestsException" },
      });

    await expect(deliverer(fake)(outbound())).rejects.toMatchObject({
      kind: "throttled",
      retryable: true,
      statusCode: 429,
      recipient: "sam@example.com",
    });
  });

  it("throws a NON-retryable error on a suppressed destination", async () => {
    const fake: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          __type: "MessageRejected",
          message: "Recipient is on the suppression list for your account",
        }),
        { status: 400 },
      );

    await expect(deliverer(fake)(outbound())).rejects.toMatchObject({
      kind: "suppressed",
      retryable: false,
    });
  });

  it("classifies a request that never got an answer as transient", async () => {
    const fake: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(deliverer(fake)(outbound())).rejects.toMatchObject({
      kind: "transient",
      retryable: true,
      statusCode: null,
    });
  });

  it("does NOT fail a recipient over an unparseable 200", async () => {
    // The message went out. Throwing would mark a delivered recipient `failed`
    // and invite a retry that duplicates a real email.
    const fake: typeof fetch = async () => new Response("ok", { status: 200 });
    await expect(deliverer(fake)(outbound())).resolves.toEqual({ id: undefined });
  });

  it("makes exactly one request per message", async () => {
    let count = 0;
    const fake: typeof fetch = async () => {
      count += 1;
      return new Response(JSON.stringify({ MessageId: "x" }), { status: 200 });
    };
    await deliverer(fake)(outbound());
    // No internal retry loop. Retry policy belongs to the (unbuilt) sweep,
    // which is the only layer that can see `attempts` and the failure kind.
    expect(count).toBe(1);
  });
});
