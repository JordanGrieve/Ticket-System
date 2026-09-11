/**
 * Resend delivery for CAMPAIGNS — the second real provider.
 *
 * ── WHY A SECOND ONE ──
 *
 * SES was chosen for bulk (docs/NEWSLETTER.md §1.2, §1.4) because of per-tenant
 * reputation isolation. That argument is still correct and is still the reason
 * lib/deliver-ses.ts exists. What overtook it is that the AWS account never got
 * out of the sandbox: case 178747420600793 was submitted on 23 Aug 2026 and
 * DENIED on 26 Aug, so SES can mail verified addresses only. A campaign path
 * that cannot reach a stranger is not a campaign path.
 *
 * Resend is already the transactional provider (lib/email.ts), the domain is
 * already ours to verify, and the account is live. So campaigns leave through
 * it too, via the SAME `/emails` API that ticket acknowledgements use.
 *
 * ── THE ONE THING TO UNDERSTAND ABOUT THE NUMBERS ──
 *
 * Resend prices two separate products. Broadcasts (`/broadcasts`) are metered
 * by CONTACTS and do not touch the transactional allowance at all. `/emails` is
 * metered by EMAILS, and that is the API this file calls — so every campaign
 * recipient spends from the SAME monthly pool as every ticket reply, and from
 * the same daily cap on the free plan (100/day, both sent AND received).
 *
 * That is a deliberate trade, not an oversight. Broadcasts can only be sent to
 * contacts stored in Resend's own Audiences, and their unsubscribe link
 * unsubscribes from Resend's audience rather than from our `subscribers` table
 * — so adopting them would mean mirroring every tenant's list into one shared
 * Resend account and giving up our own consent record. One pool is cheaper than
 * two sources of truth about who has opted out.
 *
 * The consequence is a real one and belongs in the open: on the free plan a
 * newsletter to more than a hundred people will exhaust the day and take the
 * tenant's ticket acknowledgements down with it. lib/email-quota.ts is the
 * alarm for exactly that, and `onSent` below is how a campaign send reaches it.
 *
 * ── 10 REQUESTS PER SECOND, PER TEAM ──
 *
 * Not per API key — per TEAM, shared with every transactional send. Confirmed
 * on resend.com/docs/api-reference/introduction, 11 Sep 2026. The send loop in
 * lib/campaign-send.ts has no pacing of its own and no retry: it stores a
 * throw as `campaign_recipients.error` and never looks at that row again. So a
 * burst that trips the limit does not slow the campaign down, it PERMANENTLY
 * drops those recipients. The pacer and the throttle retry below are what stand
 * between a fast batch and a silently short mailout.
 *
 * ── CONFIG ──
 *
 * Everything arrives as an argument, like lib/deliver-ses.ts. This module reads
 * no environment variable; lib/deliver.ts is the one place `process.env` is
 * consulted.
 */
import "server-only";
import { createHash } from "node:crypto";
import { Resend } from "resend";
import type { OutboundCampaignEmail } from "./campaign-send";
import { isRetryableFailure, type DeliveryFailureKind } from "./deliver-ses";

// ── The provider call, narrowed ──────────────────────────────────

/**
 * The shape of `resend.emails.send`, reduced to what this file uses.
 *
 * Declared rather than imported from the SDK so a test can supply a plain
 * function without reconstructing `CreateEmailOptions`, which is a large
 * conditional type built around React rendering we do not use. The real call is
 * assigned to this in `defaultSend`, so the compiler still checks the shape
 * against the SDK at the one point it matters.
 */
export type ResendSendFn = (
  payload: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
  },
  options: { idempotencyKey: string },
) => Promise<{
  data: { id: string } | null;
  error: { name?: string | null; message?: string | null; statusCode?: number | null } | null;
}>;

export type ResendDelivererConfig = {
  /** The Resend API key. Required — there is no "unauthenticated" mode. */
  apiKey: string;
  /**
   * Minimum gap between provider calls, in ms.
   *
   * 250ms is four a second against a team-wide ceiling of ten, leaving six for
   * the transactional path. It is a FLOOR, not a delay added to every call: the
   * send loop already spends ~280ms per recipient on two database round trips
   * and the send itself, so on a healthy batch this waits for nothing at all
   * and only bites when the loop runs faster than the provider allows.
   */
  minIntervalMs?: number;
  /**
   * How many extra attempts a THROTTLED send gets before the row is failed.
   *
   * Only throttles are retried, and that restriction is the whole safety
   * argument: a 429 is the provider saying it did not accept the message, so
   * sending it again cannot duplicate it. A timeout says nothing of the kind.
   */
  maxThrottleRetries?: number;
  /** Backoff before throttle retry n (1-based), in ms. Doubles each time. */
  throttleBackoffMs?: number;
  /** Per-request ceiling. The SDK has no timeout of its own. */
  timeoutMs?: number;
  /**
   * Called after a send the provider ACCEPTED, never before and never on
   * failure. This is how a campaign recipient reaches the platform-wide daily
   * counter in lib/email-quota-store.ts — which this module cannot import
   * itself, because that module reaches the database and lib/deliver.ts must
   * stay importable by tests with no DATABASE_URL.
   *
   * Failures here are swallowed by the caller's contract: the email has already
   * gone, and a counter outage must not become a delivery outage.
   */
  onSent?: () => void | Promise<void>;
  /** Injected in tests. Defaults to the real SDK call. */
  send?: ResendSendFn;
  /** Injected in tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests. Defaults to `Date.now`. */
  now?: () => number;
};

// ── Errors ───────────────────────────────────────────────────────

export class ResendDeliveryError extends Error {
  readonly kind: DeliveryFailureKind;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  /** Resend's own error name, e.g. "rate_limit_exceeded". */
  readonly providerCode: string | null;
  readonly recipient: string | null;

  constructor(input: {
    message: string;
    kind: DeliveryFailureKind;
    statusCode?: number | null;
    providerCode?: string | null;
    recipient?: string | null;
  }) {
    // The kind is baked into the message because the send loop stores
    // `err.message` verbatim in `campaign_recipients.error` and nothing else.
    // A report that says only "validation_error" cannot tell an operator
    // whether the row is safe to send again.
    super(`[${input.kind}] ${input.message}`);
    this.name = "ResendDeliveryError";
    this.kind = input.kind;
    this.retryable = isRetryableFailure(input.kind);
    this.statusCode = input.statusCode ?? null;
    this.providerCode = input.providerCode ?? null;
    this.recipient = input.recipient ?? null;
  }
}

/**
 * Resend error names, from resend.com/docs/api-reference/errors (11 Sep 2026).
 *
 * Grouped by what a caller can DO about them, which is not the same as grouping
 * by status code — 429 covers both "you were too fast" (retry in a moment) and
 * "your plan is spent" (retrying today changes nothing at all).
 */
const THROTTLE_NAMES = new Set(["rate_limit_exceeded"]);

/**
 * Quota, not rate.
 *
 * `paused` and not `throttled`, and the distinction is the point: a daily or
 * monthly quota does not clear in seconds and no amount of backoff reaches it.
 * Classifying it retryable would have the sweep spend the rest of the run
 * hammering a provider that has already said no, five minutes later do it
 * again, and bury the one log line that says "upgrade the plan".
 *
 * It is also not `permanent`, because the recipient did nothing wrong and the
 * address is fine. That distinction is what lets a future requeue sweep tell a
 * blown quota apart from a dead mailbox.
 */
const QUOTA_NAMES = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

const TRANSIENT_NAMES = new Set([
  "application_error",
  "internal_server_error",
  "service_unavailable",
  // Another request with this idempotency key is still in flight. Ours or a
  // concurrent sweep's; either way the answer is to come back, not to give up.
  "concurrent_idempotent_requests",
  "resource_locked",
]);

const PAUSED_NAMES = new Set(["suspended_api_key"]);

/**
 * Normalise whatever Resend returned into a kind.
 *
 * Pure and total, so the classification is provable with no network. Matched on
 * the NAME first and the status only as a fallback, because the names carry the
 * distinction the status codes lose (see QUOTA_NAMES).
 */
export function classifyResendError(input: {
  statusCode?: number | null;
  name?: string | null;
  message?: string | null;
}): DeliveryFailureKind {
  const name = (input.name ?? "").trim().toLowerCase();
  const message = (input.message ?? "").toLowerCase();
  const status = input.statusCode ?? null;

  if (QUOTA_NAMES.has(name)) return "paused";
  if (THROTTLE_NAMES.has(name)) return "throttled";
  if (TRANSIENT_NAMES.has(name)) return "transient";
  if (PAUSED_NAMES.has(name)) return "paused";

  // Resend accepts a send to a suppressed address and drops it later rather
  // than refusing at the door, so this branch is rare — but if the wording ever
  // appears, mirroring it into our own suppressions table is the right response
  // and `permanent` would hide that.
  if (message.includes("suppress")) return "suppressed";

  if (status === 429) {
    // A 429 with no name we recognise. Treat it as rate rather than quota: the
    // cost of a wrong guess here is one wasted backoff, where the other way
    // round is a campaign that stops on a limit that would have cleared.
    return "throttled";
  }
  if (status !== null && status >= 500) return "transient";
  if (status !== null && status >= 400) return "permanent";

  // No status and no recognised name. Not retryable — see isRetryableFailure:
  // the unknown case fails safe towards "do not send this again".
  return "permanent";
}

// ── Idempotency ──────────────────────────────────────────────────

/** Prefix on every key this module generates, so one is recognisable in a log. */
export const IDEMPOTENCY_PREFIX = "pbx-";

/**
 * A key that is the same for the same message and different for every other.
 *
 * ── WHY THIS IS WORTH THE HASH ──
 *
 * `sendCampaignBatch` claims a row BEFORE it sends, so the one loss window it
 * documents is a crash between the claim and the provider call: that email is
 * dropped rather than duplicated, on purpose, because a duplicate mailout is
 * the worse failure. An idempotency key turns that trade-off into a free
 * choice — Resend deduplicates for 24 hours, so a retry of an ambiguous send
 * returns the ORIGINAL message id instead of mailing anybody twice.
 *
 * Derived from the message rather than passed in, because passing it in would
 * mean a tenth optional field on `OutboundCampaignEmail` and a call site free
 * to forget it — the exact shape of the bug AGENTS.md describes under "A new
 * field reaches the database only where somebody listed it".
 *
 * The unsubscribe URL is in the hash and is what makes the key per-RECIPIENT:
 * it carries that subscriber's own token. Two different people receiving the
 * identical campaign therefore get different keys, which is the property that
 * matters — a shared key would have Resend deliver the campaign to the first
 * recipient and silently return that same id for everyone else.
 */
export function idempotencyKeyFor(email: OutboundCampaignEmail): string {
  const unsubscribe =
    Object.entries(email.headers ?? {}).find(
      ([k]) => k.toLowerCase() === "list-unsubscribe",
    )?.[1] ?? "";
  const digest = createHash("sha256")
    .update(
      [email.to, email.from, email.subject, unsubscribe, email.html].join("|"),
      "utf8",
    )
    .digest("hex");
  return `${IDEMPOTENCY_PREFIX}${digest.slice(0, 48)}`;
}

// ── The deliverer ────────────────────────────────────────────────

function realSend(apiKey: string): ResendSendFn {
  const resend = new Resend(apiKey);
  return (payload, options) => resend.emails.send(payload, options);
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `work`, or throw a transient error if it outlives `timeoutMs`.
 *
 * The SDK exposes no abort signal, so the request is not actually cancelled —
 * this bounds how long the SWEEP waits, not how long Resend takes. That is the
 * useful half: the function budget is 60 seconds for the whole batch and one
 * hung socket must not consume it.
 *
 * `transient` and NOT retried, deliberately. A request that timed out may well
 * have been accepted, and the idempotency key is what makes a LATER retry safe
 * — not a retry from inside this call, which would race the request still in
 * flight and collect a 409.
 */
async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  recipient: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ResendDeliveryError({
                kind: "transient",
                message: `Resend did not answer within ${timeoutMs}ms`,
                recipient,
              }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    // Without this the pending timer keeps the function alive after a fast
    // success, which on a serverless runtime is billed time and, in tests with
    // fake timers, a handle that never settles.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Build a live Resend deliverer.
 *
 * Constructing one sends nothing, but it is the object that can, so nothing
 * should construct it except `createCampaignDeliverer` in lib/deliver.ts behind
 * the `CAMPAIGN_DELIVERY_MODE=resend` opt-in.
 *
 * Every failure path throws `ResendDeliveryError`, so the caller always gets
 * the retryable/permanent distinction rather than re-parsing a message.
 */
export function createResendDeliverer(
  config: ResendDelivererConfig,
): (email: OutboundCampaignEmail) => Promise<{ id?: string }> {
  const send = config.send ?? realSend(config.apiKey);
  const sleep = config.sleep ?? realSleep;
  const now = config.now ?? (() => Date.now());
  const minIntervalMs = config.minIntervalMs ?? 250;
  const maxThrottleRetries = config.maxThrottleRetries ?? 3;
  const throttleBackoffMs = config.throttleBackoffMs ?? 1_000;
  const timeoutMs = config.timeoutMs ?? 15_000;

  // Closure, not module state: one deliverer is built per sweep invocation and
  // used for every recipient in it, which is exactly the span the pacing needs
  // to cover. Module state would also make two tests in one process share a
  // clock.
  let lastCallAt: number | null = null;

  async function pace(): Promise<void> {
    if (lastCallAt === null) return;
    const since = now() - lastCallAt;
    if (since < minIntervalMs) await sleep(minIntervalMs - since);
  }

  return async (email: OutboundCampaignEmail) => {
    const idempotencyKey = idempotencyKeyFor(email);
    const payload = {
      from: email.from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(Object.keys(email.headers ?? {}).length > 0
        ? { headers: { ...email.headers } }
        : {}),
    };

    for (let attempt = 0; ; attempt += 1) {
      await pace();
      lastCallAt = now();

      let result: Awaited<ReturnType<ResendSendFn>>;
      try {
        result = await withTimeout(
          send(payload, { idempotencyKey }),
          timeoutMs,
          email.to,
        );
      } catch (err) {
        // Already ours (the timeout) — pass it through with its kind intact.
        if (err instanceof ResendDeliveryError) throw err;
        // No answer at all: DNS, TLS, a socket reset. Same reasoning as the
        // timeout above — the message may have been accepted, so this is
        // transient and is NOT retried from here.
        throw new ResendDeliveryError({
          kind: "transient",
          message: `Resend request failed before a response: ${
            err instanceof Error ? err.message : String(err)
          }`,
          recipient: email.to,
        });
      }

      if (result.error) {
        const kind = classifyResendError(result.error);
        const name = (result.error.name ?? "").trim();
        const detail = result.error.message ?? "no message";

        if (kind === "throttled" && attempt < maxThrottleRetries) {
          // Exponential, from the config value. The provider has told us it
          // accepted nothing, so this cannot duplicate.
          await sleep(throttleBackoffMs * 2 ** attempt);
          continue;
        }

        throw new ResendDeliveryError({
          kind,
          message:
            kind === "throttled"
              ? `Resend rate limit, still refusing after ${maxThrottleRetries} retries: ${detail}`
              : `Resend ${result.error.statusCode ?? "error"}${
                  name ? ` ${name}` : ""
                }: ${detail}`,
          statusCode: result.error.statusCode ?? null,
          providerCode: name || null,
          recipient: email.to,
        });
      }

      // Accepted. Count it against the platform-wide daily ceiling — a campaign
      // recipient spends from the same pool as a ticket acknowledgement, so a
      // counter that only saw transactional mail would report a quiet day right
      // up to the moment the provider started refusing.
      if (config.onSent) await config.onSent();

      // A 200 with no id is not an error: the message went out and the row
      // keeps a null providerMessageId, the same residue claim-before-send
      // already produces. Throwing here would mark a delivered recipient
      // `failed` and invite a retry.
      return { id: result.data?.id };
    }
  };
}
