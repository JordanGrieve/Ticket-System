/**
 * Amazon SES v2 delivery — the real one.
 *
 * ── WHY THERE IS NO AWS SDK IMPORT HERE ──
 *
 * `@aws-sdk/client-sesv2` is NOT a dependency of this project and this file
 * deliberately does not add one. The SESv2 send API is a single JSON POST; the
 * only thing the SDK would supply is SigV4, which is ~60 lines of node:crypto
 * below and is fully unit-testable without a network. Adding the SDK would pull
 * a large transitive tree into a Vercel function for one endpoint, and the
 * decision to take on that weight is not one an adapter should make on its own.
 * If a future need appears (STS role chaining, IMDS credentials, adaptive
 * retry) the SDK is the right answer and this file is a thin thing to replace.
 *
 * ── WHY RAW MIME AND NOT `Content.Simple` ──
 *
 * `SendEmail` with simple content does not give a guaranteed home for arbitrary
 * headers, and `List-Unsubscribe` / `List-Unsubscribe-Post` are not optional
 * decoration on bulk mail — Gmail and Yahoo require one-click unsubscribe from
 * bulk senders, and a send path that can silently drop those headers is a send
 * path that will. Raw MIME (the SendRawEmail shape) puts them on the wire
 * verbatim, where a test can assert on the exact bytes. `buildRawMessage` is
 * exported and pure for that reason.
 *
 * The headers themselves are built by `listUnsubscribeHeaders` in
 * lib/newsletter.ts and arrive on the `OutboundCampaignEmail`. This file does
 * not construct them and must not: one implementation of the RFC 8058 rules,
 * in the pure module, tested there.
 *
 * ── CONFIG ──
 *
 * Everything comes in as an argument. This module reads no environment
 * variable and imports no config — see lib/deliver.ts, which is the one place
 * `process.env` is consulted.
 */
import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { OutboundCampaignEmail } from "./campaign-send";

// ── Configuration ────────────────────────────────────────────────

export type SesCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present when the caller is using temporary STS credentials. */
  sessionToken?: string | null;
};

export type SesDelivererConfig = {
  /** e.g. "eu-west-1". Determines the endpoint and the SigV4 credential scope. */
  region: string;
  credentials: SesCredentials;
  /**
   * SES configuration set. OPTIONAL to SES, effectively mandatory to us: it is
   * what routes bounce, complaint and delivery events to SNS/EventBridge. Send
   * without one and the feedback loop in docs/NEWSLETTER.md §6 does not exist,
   * which is how a sending account gets terminated.
   */
  configurationSetName?: string | null;
  /**
   * SES tenant. One per workspace is the entire reason SES was chosen over
   * Resend (docs/NEWSLETTER.md §1.2, §1.4): per-tenant reputation metrics,
   * per-tenant suppression lists, and auto-pause that stops the OFFENDING
   * tenant rather than the account. Omitting it puts every workspace back in
   * one shared reputation pool, which is the failure this design exists to
   * avoid.
   */
  tenantName?: string | null;
  /**
   * Envelope return path (SES: FeedbackForwardingEmailAddress). Where SES
   * forwards feedback when the configuration set does not capture it. Distinct
   * from the header From — a bounce must not land in the marketing mailbox a
   * human reads.
   */
  returnPath?: string | null;
  /** Overridden in tests. Defaults to the regional SESv2 endpoint. */
  endpoint?: string;
  /** Overridden in tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Defaults to 15s. */
  timeoutMs?: number;
  /** Injected in tests so the signature and the MIME are deterministic. */
  now?: () => Date;
  /** Injected in tests. Produces the MIME boundary and Message-ID token. */
  tokenFactory?: () => string;
};

export function sesEndpoint(region: string): string {
  return `https://email.${region}.amazonaws.com`;
}

// ── Error classification ─────────────────────────────────────────

/**
 * Why a send failed, in the only terms the caller can act on.
 *
 * The distinction that matters most is the last two against the first two. A
 * throttle means "the address is fine, you were too fast" and the message
 * should go out again shortly. A hard bounce or a suppressed destination means
 * the mailbox does not exist or its owner reported us for spam, and re-sending
 * it is not a retry — it is a second offence, charged to the sending domain
 * that every other tenant's mail also leaves from. `attempts` on
 * `campaign_recipients` cannot tell those apart on its own; this can.
 *
 *  - `throttled`   — rate or quota exceeded. Retry after backoff. Address fine.
 *  - `transient`   — 5xx, timeout, socket error. Retry. Address fine.
 *  - `paused`      — the account or the tenant is paused, usually by an SES
 *                    reputation policy. Retrying changes nothing and every
 *                    attempt is more evidence; a human must clear it. NOT
 *                    retryable, but NOT the recipient's fault either, which is
 *                    why it is not folded into `permanent`.
 *  - `suppressed`  — SES refused because the address is on a suppression list
 *                    (a prior hard bounce or complaint). NEVER retry, and this
 *                    is a signal to mirror into our own `suppressions` table.
 *  - `permanent`   — rejected, unverified identity, malformed request, bad
 *                    credentials. NEVER retry automatically; every one of these
 *                    needs either a different address or a human.
 */
export type DeliveryFailureKind =
  | "throttled"
  | "transient"
  | "paused"
  | "suppressed"
  | "permanent";

/**
 * The ONLY kinds a retry sweep may act on.
 *
 * Written as an allowlist, not a denylist of the bad ones. A failure kind added
 * later defaults to "do not retry", which is the direction that fails safe: the
 * cost of not retrying a retryable message is one lost email, and the cost of
 * retrying a hard bounce is deliverability damage for every tenant.
 */
export function isRetryableFailure(kind: DeliveryFailureKind): boolean {
  return kind === "throttled" || kind === "transient";
}

export class SesDeliveryError extends Error {
  readonly kind: DeliveryFailureKind;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  /** The AWS error type, e.g. "TooManyRequestsException". */
  readonly awsCode: string | null;
  readonly recipient: string | null;

  constructor(input: {
    message: string;
    kind: DeliveryFailureKind;
    statusCode?: number | null;
    awsCode?: string | null;
    recipient?: string | null;
  }) {
    // The message is what lands in `campaign_recipients.error` verbatim — the
    // send loop stores `err.message` — so the kind is baked into it. A report
    // that says only "MessageRejected" cannot tell an operator whether the row
    // is safe to retry.
    super(`[${input.kind}] ${input.message}`);
    this.name = "SesDeliveryError";
    this.kind = input.kind;
    this.retryable = isRetryableFailure(input.kind);
    this.statusCode = input.statusCode ?? null;
    this.awsCode = input.awsCode ?? null;
    this.recipient = input.recipient ?? null;
  }
}

const THROTTLE_CODES = new Set([
  "throttling",
  "throttlingexception",
  "toomanyrequestsexception",
  "limitexceededexception",
  "requestthrottled",
  "provisionedthroughputexceededexception",
  "slowdown",
]);

const PAUSED_CODES = new Set([
  "accountsuspendedexception",
  "sendingpausedexception",
  "accountsendingpausedexception",
  "configurationsetsendingpausedexception",
]);

const SUPPRESSED_CODES = new Set([
  "suppresseddestination",
  "suppresseddestinationexception",
  "accountsuppressionlistexception",
]);

const PERMANENT_CODES = new Set([
  "messagerejected",
  "mailfromdomainnotverifiedexception",
  "mailfromdomainnotverified",
  "badrequestexception",
  "validationexception",
  "invalidparametervalue",
  "notfoundexception",
  "alreadyexistsexception",
  "accountnotfound",
  "accessdenied",
  "accessdeniedexception",
  "unrecognizedclientexception",
  "invalidclienttokenid",
  "signaturedoesnotmatch",
  "incompletesignature",
  "expiredtokenexception",
  "invalidsesv2configuration",
]);

/**
 * Normalise whatever AWS returned into a kind.
 *
 * AWS puts the error type in three different places depending on the failure —
 * the `x-amzn-errortype` header, a `__type` field, or a bare `Code` — and the
 * type is sometimes namespaced (`com.amazonaws...#TooManyRequestsException`)
 * and sometimes suffixed with a URL. This strips all of that before matching.
 *
 * Pure and total, so the classification can be proved in tests without a
 * network. That matters more than usual here: the difference between
 * `throttled` and `suppressed` is the difference between a retry and a repeat
 * offence, and it is not something to discover in production.
 */
export function classifySesError(input: {
  statusCode?: number | null;
  code?: string | null;
  message?: string | null;
}): DeliveryFailureKind {
  const code = normaliseAwsCode(input.code);
  const message = (input.message ?? "").toLowerCase();
  const status = input.statusCode ?? null;

  if (code && SUPPRESSED_CODES.has(code)) return "suppressed";
  if (code && PAUSED_CODES.has(code)) return "paused";
  if (code && THROTTLE_CODES.has(code)) return "throttled";

  // Message-text fallbacks, and they are checked BEFORE `PERMANENT_CODES` on
  // purpose. `MessageRejected` is SES's catch-all 400: it is the code returned
  // for an unverified identity (permanent), for a suppressed destination
  // (permanent AND a signal to mirror into our own suppressions), and for
  // "Maximum sending rate exceeded" (a throttle that must be retried). The
  // prose is the more specific evidence, so it wins over the generic code.
  //
  // Only the conditions where guessing wrong is expensive are matched here.
  if (
    message.includes("suppression list") ||
    message.includes("suppressed destination")
  ) {
    return "suppressed";
  }
  if (
    message.includes("sending paused") ||
    message.includes("account is paused") ||
    message.includes("sending has been paused")
  ) {
    return "paused";
  }
  if (message.includes("maximum sending rate exceeded")) return "throttled";
  if (message.includes("daily message quota exceeded")) return "throttled";

  if (code && PERMANENT_CODES.has(code)) return "permanent";

  if (status === 429) return "throttled";
  if (status !== null && status >= 500) return "transient";
  // Every other 4xx is the request's fault, not the network's. Retrying a
  // malformed or unauthorised request forever is how a queue never drains.
  if (status !== null && status >= 400) return "permanent";

  // No status at all means the request never got an answer — DNS, TLS, socket,
  // abort. That is the one unknown that IS worth retrying.
  return "transient";
}

function normaliseAwsCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // "com.amazonaws.sesv2#TooManyRequestsException" → "toomanyrequestsexception"
  // "MessageRejected:" / "Throttling: Rate exceeded" → "messagerejected"
  const afterHash = raw.split("#").pop() ?? raw;
  const cleaned = afterHash.split(":")[0].trim().toLowerCase();
  return cleaned || null;
}

// ── MIME ─────────────────────────────────────────────────────────

/**
 * Strip anything that could start a new header.
 *
 * Header values here are derived from client data — the campaign subject, the
 * workspace name in the From display, the recipient address. A CR or LF that
 * survived into a header is header injection: an extra `Bcc:`, or a second
 * `List-Unsubscribe` pointing anywhere the injector likes. `parseCampaignInput`
 * already collapses whitespace in the subject, which is why this has never
 * mattered; it is here so it still does not matter when something else starts
 * building these values.
 */
export function sanitiseHeaderValue(value: string): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** RFC 2047 encoded-word, but only when the value is not already plain ASCII. */
export function encodeHeaderValue(value: string): string {
  const clean = sanitiseHeaderValue(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** RFC 5322 date. `toUTCString` gives "GMT"; the RFC wants a numeric offset. */
export function rfc5322Date(at: Date): string {
  return at.toUTCString().replace(/GMT$/, "+0000");
}

function base64Body(text: string): string {
  const encoded = Buffer.from(text ?? "", "utf8").toString("base64");
  return (encoded.match(/.{1,76}/g) ?? []).join("\r\n");
}

export type RawMessageOptions = {
  /** MIME boundary and Message-ID token. Injected so tests are deterministic. */
  token: string;
  at: Date;
  /** Domain for the Message-ID. Derived from the From address when omitted. */
  messageIdDomain?: string | null;
};

/**
 * Build the RFC 5322 message SES will send verbatim.
 *
 * multipart/alternative with the text part first — the order is the semantic
 * one: last part wins, so HTML must come second or every modern client shows
 * the plain text. Both parts are base64 so a UTF-8 body, a long unbroken URL,
 * or a line over 998 characters cannot corrupt the message on the wire.
 *
 * Caller headers are written BEFORE Content-Type and after the standard set,
 * and cannot overwrite MIME-Version or Content-Type — a caller who managed to
 * replace the boundary declaration would produce a message that renders as
 * garbage to every recipient. `List-Unsubscribe` and friends live here.
 *
 * Pure. Same inputs, same bytes, which is what makes the header assertions in
 * tests/deliver-ses.test.ts meaningful.
 */
export function buildRawMessage(
  email: OutboundCampaignEmail,
  options: RawMessageOptions,
): string {
  const boundary = `----=_Postbox_${options.token}`;
  const from = sanitiseHeaderValue(email.from);
  const domain =
    options.messageIdDomain ??
    (from.match(/@([^\s>]+)/)?.[1] ?? "postbox.help").replace(/[>,;].*$/, "");

  const lines: string[] = [
    `From: ${sanitiseHeaderValue(email.from)}`,
    `To: ${sanitiseHeaderValue(email.to)}`,
    `Subject: ${encodeHeaderValue(email.subject)}`,
    `Date: ${rfc5322Date(options.at)}`,
    `Message-ID: <${options.token}@${domain}>`,
    "MIME-Version: 1.0",
  ];

  // Reserved: set by us, from the structure of the message. A caller-supplied
  // value for any of these is dropped rather than merged.
  const reserved = new Set([
    "from",
    "to",
    "subject",
    "date",
    "message-id",
    "mime-version",
    "content-type",
    "content-transfer-encoding",
    "bcc",
  ]);

  for (const [name, value] of Object.entries(email.headers ?? {})) {
    const key = name.trim().toLowerCase();
    if (!key || reserved.has(key)) continue;
    // The NAME is sanitised too, and against a stricter rule: RFC 5322 allows
    // printable ASCII except colon, and anything else is not a header, it is an
    // attempt to be one.
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(name.trim())) continue;
    lines.push(`${name.trim()}: ${sanitiseHeaderValue(value)}`);
  }

  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push("");
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(base64Body(email.text));
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(base64Body(email.html));
  lines.push(`--${boundary}--`);
  lines.push("");

  return lines.join("\r\n");
}

// ── SigV4 ────────────────────────────────────────────────────────

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** "20260818T120000Z" and "20260818". */
function amzDates(at: Date): { amzDate: string; dateStamp: string } {
  const amzDate = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export type SignedRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

/**
 * AWS Signature Version 4, for one JSON POST.
 *
 * Scoped to exactly what this adapter needs: no query string, no multi-value
 * headers, no chunked payload signing. That narrowness is deliberate — a
 * general SigV4 implementation is the SDK's job, and the moment this needs to
 * grow one, take the SDK instead.
 *
 * Pure given `at`, which is why the test can assert a byte-exact Authorization
 * header against fixed credentials and a fixed clock.
 */
export function signSesRequest(input: {
  method: string;
  endpoint: string;
  path: string;
  region: string;
  body: string;
  credentials: SesCredentials;
  at: Date;
  service?: string;
}): SignedRequest {
  const service = input.service ?? "ses";
  const host = new URL(input.endpoint).host;
  const { amzDate, dateStamp } = amzDates(input.at);
  const payloadHash = sha256Hex(input.body);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (input.credentials.sessionToken) {
    headers["x-amz-security-token"] = input.credentials.sessionToken;
  }

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders
    .map((h) => `${h}:${headers[h].trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaderList = signedHeaders.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    "", // no query string
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    url: `${input.endpoint.replace(/\/$/, "")}${input.path}`,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
    },
    body: input.body,
  };
}

// ── The request body ─────────────────────────────────────────────

export const SES_SEND_PATH = "/v2/email/outbound-emails";

export type SesSendRequest = {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  Content: { Raw: { Data: string } };
  ConfigurationSetName?: string;
  TenantName?: string;
  FeedbackForwardingEmailAddress?: string;
};

/**
 * The SESv2 SendEmail payload for ONE recipient.
 *
 * One address per call, always. Batching recipients into a single Destination
 * would be cheaper and would break the two things this pipeline is built on:
 * the unsubscribe token in `List-Unsubscribe` is per-recipient, so a shared
 * message would hand every recipient the same opt-out link, and the returned
 * MessageId would map to N rows in `campaign_recipients` instead of one,
 * making the bounce webhook unable to say who bounced. The claim-before-send
 * loop already calls this once per row; the envelope matches it.
 *
 * Pure, so the tenant and configuration-set wiring is assertable.
 */
export function buildSesSendRequest(input: {
  email: OutboundCampaignEmail;
  raw: string;
  configurationSetName?: string | null;
  tenantName?: string | null;
  returnPath?: string | null;
}): SesSendRequest {
  const body: SesSendRequest = {
    FromEmailAddress: sanitiseHeaderValue(input.email.from),
    Destination: { ToAddresses: [sanitiseHeaderValue(input.email.to)] },
    Content: { Raw: { Data: Buffer.from(input.raw, "utf8").toString("base64") } },
  };
  if (input.configurationSetName) {
    body.ConfigurationSetName = input.configurationSetName;
  }
  if (input.tenantName) body.TenantName = input.tenantName;
  if (input.returnPath) {
    body.FeedbackForwardingEmailAddress = sanitiseHeaderValue(input.returnPath);
  }
  return body;
}

/** Pull the AWS error type out of wherever this particular failure put it. */
export function extractAwsError(
  status: number,
  headerType: string | null,
  rawBody: string,
): { code: string | null; message: string } {
  let code = headerType;
  let message = rawBody.slice(0, 500);
  try {
    const parsed = JSON.parse(rawBody) as {
      __type?: string;
      Code?: string;
      code?: string;
      message?: string;
      Message?: string;
    };
    code = code ?? parsed.__type ?? parsed.Code ?? parsed.code ?? null;
    message = parsed.message ?? parsed.Message ?? message;
  } catch {
    // Not JSON — an ALB or a proxy error page. The status still classifies it.
  }
  return { code, message: message || `SES returned HTTP ${status}` };
}

// ── The deliverer ────────────────────────────────────────────────

function randomToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Build a live SES deliverer.
 *
 * Constructing one does NOT send anything, but it is the object that can, so
 * nothing should construct it except `createCampaignDeliverer` in lib/deliver.ts
 * behind the `CAMPAIGN_DELIVERY_MODE=ses` opt-in.
 *
 * Every failure path throws `SesDeliveryError`, so the caller always gets the
 * retryable/permanent distinction rather than having to re-parse a message.
 * `sendCampaignBatch` stores `err.message`, which carries the kind in a
 * leading `[…]` tag — enough for a human reading the campaign report, and
 * enough for a future retry sweep to grep until it is passed the error object
 * directly.
 */
export function createSesDeliverer(
  config: SesDelivererConfig,
): (email: OutboundCampaignEmail) => Promise<{ id?: string }> {
  const endpoint = config.endpoint ?? sesEndpoint(config.region);
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const now = config.now ?? (() => new Date());
  const tokenFactory = config.tokenFactory ?? randomToken;

  return async (email: OutboundCampaignEmail) => {
    const at = now();
    const raw = buildRawMessage(email, { token: tokenFactory(), at });
    const payload = JSON.stringify(
      buildSesSendRequest({
        email,
        raw,
        configurationSetName: config.configurationSetName,
        tenantName: config.tenantName,
        returnPath: config.returnPath,
      }),
    );

    const signed = signSesRequest({
      method: "POST",
      endpoint,
      path: SES_SEND_PATH,
      region: config.region,
      body: payload,
      credentials: config.credentials,
      at,
    });

    let response: Response;
    try {
      response = await doFetch(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // No HTTP answer at all: DNS, TLS, socket reset, or our own timeout. The
      // message may or may not have been accepted, which is precisely the case
      // claim-before-send is designed around — the row is already `sent`, so a
      // retry here would risk a duplicate. Classified transient so a future
      // sweep can reconcile it by message id rather than blindly re-sending.
      throw new SesDeliveryError({
        kind: "transient",
        message: `SES request failed before a response: ${
          err instanceof Error ? err.message : String(err)
        }`,
        recipient: email.to,
      });
    }

    const text = await response.text();

    if (!response.ok) {
      const { code, message } = extractAwsError(
        response.status,
        response.headers.get("x-amzn-errortype"),
        text,
      );
      throw new SesDeliveryError({
        kind: classifySesError({
          statusCode: response.status,
          code,
          message,
        }),
        message: `SES ${response.status}${code ? ` ${code}` : ""}: ${message}`,
        statusCode: response.status,
        awsCode: code,
        recipient: email.to,
      });
    }

    let messageId: string | undefined;
    try {
      messageId = (JSON.parse(text) as { MessageId?: string }).MessageId;
    } catch {
      // A 200 we cannot parse. The message almost certainly went out, so this
      // is NOT an error — throwing would mark a delivered recipient `failed`
      // and invite a retry that duplicates a real email. The row keeps a null
      // providerMessageId, which is the same residue claim-before-send already
      // produces and which the reconciliation sweep exists to find.
      messageId = undefined;
    }

    return { id: messageId };
  };
}
