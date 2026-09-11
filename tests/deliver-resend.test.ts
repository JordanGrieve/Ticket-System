import { describe, it, expect, vi } from "vitest";
import {
  createResendDeliverer,
  classifyResendError,
  idempotencyKeyFor,
  ResendDeliveryError,
  IDEMPOTENCY_PREFIX,
  type ResendSendFn,
} from "../lib/deliver-resend";
import { isRetryableFailure } from "../lib/deliver-ses";
import type { OutboundCampaignEmail } from "../lib/campaign-send";

/**
 * The Resend campaign deliverer.
 *
 * No network anywhere in this file: every test supplies its own `send`, so the
 * SDK is constructed only in `realSend`, which nothing here reaches. That is
 * the same property tests/deliver.test.ts relies on — a test suite for the one
 * module in this codebase that can email forty thousand people must not be one
 * typo away from doing it.
 *
 * `sleep` is injected too, and asserted on rather than waited for. A test that
 * actually slept through three exponential backoffs would take seven seconds
 * and would tell you nothing the recorded delays do not.
 */

function outbound(
  overrides: Partial<OutboundCampaignEmail> = {},
): OutboundCampaignEmail {
  return {
    to: "sam@example.com",
    from: "Acme <news@news.postbox.help>",
    subject: "This week at Acme",
    text: "Body text",
    html: "<p>Body text</p>",
    headers: {
      "List-Unsubscribe":
        "<mailto:unsub@postbox.help>, <https://postbox.help/u/TOKEN-SAM>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    ...overrides,
  };
}

/** A send that always succeeds, recording what it was asked to send. */
function recordingSend(id = "re_123") {
  const calls: Array<{
    payload: Parameters<ResendSendFn>[0];
    options: Parameters<ResendSendFn>[1];
  }> = [];
  const send: ResendSendFn = async (payload, options) => {
    calls.push({ payload, options });
    return { data: { id }, error: null };
  };
  return { send, calls };
}

/** A send that fails with one Resend error, then succeeds. */
function failThenSucceed(
  error: { name?: string; message?: string; statusCode?: number },
  failures: number,
) {
  let attempts = 0;
  const send: ResendSendFn = async () => {
    attempts += 1;
    if (attempts <= failures) return { data: null, error };
    return { data: { id: "re_after_retry" }, error: null };
  };
  return { send, attempts: () => attempts };
}

/** Records the delays asked for instead of waiting them out. */
function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("classifyResendError", () => {
  it("calls a rate limit throttled — the address is fine, we were too fast", () => {
    expect(
      classifyResendError({
        statusCode: 429,
        name: "rate_limit_exceeded",
        message: "Too many requests.",
      }),
    ).toBe("throttled");
  });

  it("does NOT call a spent quota throttled, though it is also a 429", () => {
    /*
     * The distinction this whole classifier exists for. Both arrive as 429.
     * A rate limit clears in a second and backing off reaches it; a daily or
     * monthly quota does not clear until the plan does, and retrying it just
     * buries the one log line that says "upgrade".
     *
     * `paused` and not `permanent`, because the recipient did nothing wrong.
     */
    expect(
      classifyResendError({ statusCode: 429, name: "daily_quota_exceeded" }),
    ).toBe("paused");
    expect(
      classifyResendError({ statusCode: 429, name: "monthly_quota_exceeded" }),
    ).toBe("paused");
    expect(isRetryableFailure("paused")).toBe(false);
  });

  it("calls Resend's own failures transient, so a retry sweep may act on them", () => {
    for (const name of [
      "application_error",
      "internal_server_error",
      "service_unavailable",
      "concurrent_idempotent_requests",
      "resource_locked",
    ]) {
      expect(classifyResendError({ statusCode: 500, name })).toBe("transient");
    }
  });

  it("calls a bad request, a bad key and an unverified domain permanent", () => {
    // Every one of these needs a human or a different address. Retrying is
    // deliverability damage charged to the domain every tenant sends from.
    expect(
      classifyResendError({ statusCode: 403, name: "validation_error", message: "The acme.com domain is not verified." }),
    ).toBe("permanent");
    expect(classifyResendError({ statusCode: 401, name: "missing_api_key" })).toBe(
      "permanent",
    );
    expect(classifyResendError({ statusCode: 422, name: "missing_required_field" })).toBe(
      "permanent",
    );
    expect(classifyResendError({ statusCode: 404, name: "not_found" })).toBe(
      "permanent",
    );
  });

  it("calls a suspended key paused rather than permanent", () => {
    expect(
      classifyResendError({ statusCode: 403, name: "suspended_api_key" }),
    ).toBe("paused");
  });

  it("falls back to the status when the name is one it has never seen", () => {
    expect(classifyResendError({ statusCode: 429, name: "brand_new_limit" })).toBe(
      "throttled",
    );
    expect(classifyResendError({ statusCode: 503, name: "brand_new_outage" })).toBe(
      "transient",
    );
    expect(classifyResendError({ statusCode: 418, name: "teapot" })).toBe(
      "permanent",
    );
  });

  it("fails safe with neither a name nor a status", () => {
    // Unknown means "do not send this again". One lost email against a
    // possible repeat offence is not a close call.
    expect(classifyResendError({})).toBe("permanent");
    expect(isRetryableFailure(classifyResendError({}))).toBe(false);
  });

  it("recognises suppression from the wording, wherever it appears", () => {
    expect(
      classifyResendError({
        statusCode: 422,
        name: "validation_error",
        message: "This address is on your suppression list.",
      }),
    ).toBe("suppressed");
  });
});

describe("the idempotency key", () => {
  it("is stable for the same message", () => {
    expect(idempotencyKeyFor(outbound())).toBe(idempotencyKeyFor(outbound()));
  });

  it("differs per RECIPIENT, which is the property that matters", () => {
    /*
     * A key shared between two recipients would have Resend deliver the
     * campaign to the first and return that same id for everybody else — a
     * campaign reported fully sent that reached one person.
     *
     * The unsubscribe header carries the subscriber's own token, so two people
     * receiving a byte-identical campaign still get different keys. Both halves
     * are asserted: the address AND the token, because either one alone would
     * pass on a key derived only from the other.
     */
    const a = idempotencyKeyFor(outbound());
    const b = idempotencyKeyFor(
      outbound({
        to: "priya@example.com",
        headers: {
          "List-Unsubscribe":
            "<mailto:unsub@postbox.help>, <https://postbox.help/u/TOKEN-PRIYA>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
    // Same token, different address.
    const sameTokenOtherPerson = idempotencyKeyFor(
      outbound({ to: "priya@example.com" }),
    );
    // Same address, different token.
    const samePersonOtherToken = idempotencyKeyFor(
      outbound({
        headers: {
          "List-Unsubscribe":
            "<mailto:unsub@postbox.help>, <https://postbox.help/u/TOKEN-OTHER>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
    expect(new Set([a, b, sameTokenOtherPerson, samePersonOtherToken]).size).toBe(4);
  });

  it("differs when the CONTENT differs, so an edited campaign is not deduplicated", () => {
    expect(idempotencyKeyFor(outbound())).not.toBe(
      idempotencyKeyFor(outbound({ subject: "Something else" })),
    );
    expect(idempotencyKeyFor(outbound())).not.toBe(
      idempotencyKeyFor(outbound({ html: "<p>Rewritten</p>" })),
    );
  });

  it("is recognisable and inside Resend's 256-character limit", () => {
    const key = idempotencyKeyFor(outbound());
    expect(key.startsWith(IDEMPOTENCY_PREFIX)).toBe(true);
    expect(key.length).toBeGreaterThan(16);
    expect(key.length).toBeLessThanOrEqual(256);
  });

  it("still produces a key when the message carries no headers at all", () => {
    expect(idempotencyKeyFor(outbound({ headers: {} }))).toMatch(
      new RegExp(`^${IDEMPOTENCY_PREFIX}`),
    );
  });
});

describe("a successful send", () => {
  it("hands Resend the rendered parts, the single recipient and the headers", async () => {
    const { send, calls } = recordingSend();
    const deliver = createResendDeliverer({ apiKey: "re_test", send });

    const result = await deliver(outbound());

    expect(result.id).toBe("re_123");
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({
      from: "Acme <news@news.postbox.help>",
      to: ["sam@example.com"],
      subject: "This week at Acme",
      text: "Body text",
      html: "<p>Body text</p>",
    });
  });

  it("carries BOTH one-click unsubscribe headers through to the provider", async () => {
    // Gmail and Yahoo require these from a bulk sender. A send path that can
    // silently drop them is a send path that will — deliver-log asserts the
    // same thing for the same reason.
    const { send, calls } = recordingSend();
    const deliver = createResendDeliverer({ apiKey: "re_test", send });
    await deliver(outbound());
    expect(calls[0].payload.headers).toMatchObject({
      "List-Unsubscribe":
        "<mailto:unsub@postbox.help>, <https://postbox.help/u/TOKEN-SAM>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("sends exactly one address per call, never a batch", async () => {
    // Every recipient has their own unsubscribe token in their own footer, so
    // two addresses on one call would send one of them the other's link.
    const { send, calls } = recordingSend();
    const deliver = createResendDeliverer({ apiKey: "re_test", send });
    await deliver(outbound());
    expect(calls[0].payload.to).toHaveLength(1);
  });

  it("passes the idempotency key, so an ambiguous retry cannot duplicate", async () => {
    const { send, calls } = recordingSend();
    const deliver = createResendDeliverer({ apiKey: "re_test", send });
    await deliver(outbound());
    expect(calls[0].options.idempotencyKey).toBe(idempotencyKeyFor(outbound()));
  });

  it("counts the send, once, after the provider accepted it", async () => {
    const onSent = vi.fn();
    const { send } = recordingSend();
    const deliver = createResendDeliverer({ apiKey: "re_test", send, onSent });
    await deliver(outbound());
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("does NOT count a send the provider refused", async () => {
    // The counter's only job is to say how close the shared account is to its
    // ceiling. Counting refusals would overstate it every time an address was
    // wrong, which is the failure lib/email-quota-store.ts calls out by name.
    const onSent = vi.fn();
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      onSent,
      send: async () => ({
        data: null,
        error: { name: "validation_error", message: "Invalid `to` field", statusCode: 422 },
      }),
    });
    await expect(deliver(outbound())).rejects.toThrow();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("returns no id rather than throwing on a 200 with nothing in it", async () => {
    // The message went out. Throwing would mark a delivered recipient `failed`
    // and invite a retry that duplicates a real email.
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      send: async () => ({ data: null, error: null }),
    });
    await expect(deliver(outbound())).resolves.toEqual({ id: undefined });
  });
});

describe("pacing — the team-wide 10 requests per second", () => {
  it("waits out the remainder of the interval when the loop runs hot", async () => {
    const clock = fakeClock();
    const { send } = recordingSend();
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      send,
      minIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
    });

    await deliver(outbound());
    // No time passes between them: the second call is immediate.
    await deliver(outbound({ to: "b@example.com" }));

    expect(clock.slept).toEqual([250]);
  });

  it("never waits before the FIRST call", async () => {
    const clock = fakeClock();
    const { send } = recordingSend();
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      send,
      minIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
    });
    await deliver(outbound());
    expect(clock.slept).toEqual([]);
  });

  it("adds nothing when the loop is already slower than the limit", async () => {
    /*
     * The pacer is a floor, not a tax. The send loop spends ~280ms per
     * recipient on two database round trips and the send itself, so on a
     * healthy batch this must wait for nothing — otherwise it would halve the
     * throughput of a sweep that was never the problem.
     */
    const clock = fakeClock();
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      minIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
      send: async () => {
        clock.advance(400);
        return { data: { id: "re_x" }, error: null };
      },
    });

    await deliver(outbound());
    await deliver(outbound({ to: "b@example.com" }));

    expect(clock.slept).toEqual([]);
  });

  it("paces across the WHOLE sweep, not per message", async () => {
    // One deliverer is built per cron invocation and reused for every
    // recipient. A pacer that reset per call would burst straight through the
    // limit, which is the exact thing it exists to prevent.
    const clock = fakeClock();
    const { send } = recordingSend();
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      send,
      minIntervalMs: 100,
      now: clock.now,
      sleep: clock.sleep,
    });
    for (let i = 0; i < 5; i += 1) await deliver(outbound({ to: `p${i}@x.com` }));
    expect(clock.slept).toEqual([100, 100, 100, 100]);
  });
});

describe("a throttle is retried; nothing else is", () => {
  it("retries a 429 and reports the id from the attempt that landed", async () => {
    const clock = fakeClock();
    const { send, attempts } = failThenSucceed(
      { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests." },
      2,
    );
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      send,
      now: clock.now,
      sleep: clock.sleep,
      minIntervalMs: 0,
      throttleBackoffMs: 1_000,
    });

    const result = await deliver(outbound());

    expect(attempts()).toBe(3);
    expect(result.id).toBe("re_after_retry");
    // Exponential, from the configured base.
    expect(clock.slept).toEqual([1_000, 2_000]);
  });

  it("gives up after the configured number of retries and fails the row", async () => {
    const clock = fakeClock();
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      now: clock.now,
      sleep: clock.sleep,
      minIntervalMs: 0,
      maxThrottleRetries: 2,
      throttleBackoffMs: 10,
      send: async () => ({
        data: null,
        error: { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests." },
      }),
    });

    await expect(deliver(outbound())).rejects.toThrow(/still refusing after 2 retries/);
    expect(clock.slept).toEqual([10, 20]);
  });

  it("does NOT retry a timeout, because the message may already have been accepted", async () => {
    /*
     * The one that would duplicate. A 429 is the provider saying it accepted
     * nothing, which is what makes retrying it safe; a timeout says nothing of
     * the kind, and a retry from in here would race a request still in flight.
     * The idempotency key makes a LATER retry safe. This is not that.
     */
    let attempts = 0;
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      timeoutMs: 5,
      minIntervalMs: 0,
      send: async () => {
        attempts += 1;
        return new Promise(() => {}) as never;
      },
    });

    await expect(deliver(outbound())).rejects.toThrow(/did not answer within 5ms/);
    expect(attempts).toBe(1);
  });

  it("does NOT retry a quota, a permanent error, or a 500", async () => {
    for (const error of [
      { statusCode: 429, name: "daily_quota_exceeded", message: "spent" },
      { statusCode: 422, name: "validation_error", message: "bad address" },
      { statusCode: 500, name: "application_error", message: "oops" },
    ]) {
      let attempts = 0;
      const deliver = createResendDeliverer({
        apiKey: "re_test",
        minIntervalMs: 0,
        sleep: async () => {},
        send: async () => {
          attempts += 1;
          return { data: null, error };
        },
      });
      await expect(deliver(outbound())).rejects.toThrow();
      expect(attempts, `${error.name} was retried`).toBe(1);
    }
  });

  it("turns a thrown network error into a transient failure, not a crash", async () => {
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      minIntervalMs: 0,
      send: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(deliver(outbound())).rejects.toThrow(
      /\[transient\] Resend request failed before a response: fetch failed/,
    );
  });
});

describe("what the campaign report is left holding", () => {
  it("bakes the kind into the message, because that is all the row keeps", async () => {
    /*
     * `sendCampaignBatch` stores `err.message` in `campaign_recipients.error`
     * and nothing else — not the class, not the status. An operator reading
     * the report has to be able to tell "come back later" from "this address
     * is dead" out of that one string.
     */
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      minIntervalMs: 0,
      send: async () => ({
        data: null,
        error: {
          statusCode: 403,
          name: "validation_error",
          message: "The acme.com domain is not verified.",
        },
      }),
    });

    const err = await deliver(outbound()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResendDeliveryError);
    const failure = err as ResendDeliveryError;
    expect(failure.message).toContain("[permanent]");
    expect(failure.message).toContain("403");
    expect(failure.message).toContain("validation_error");
    expect(failure.message).toContain("The acme.com domain is not verified.");
    expect(failure.retryable).toBe(false);
    expect(failure.recipient).toBe("sam@example.com");
    expect(failure.providerCode).toBe("validation_error");
  });

  it("names the recipient on every failure path, including the ones with no response", async () => {
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      minIntervalMs: 0,
      send: async () => {
        throw new Error("socket hang up");
      },
    });
    const err = (await deliver(outbound()).catch((e: unknown) => e)) as ResendDeliveryError;
    expect(err.recipient).toBe("sam@example.com");
    expect(err.kind).toBe("transient");
  });

  it("says to upgrade rather than to wait when the quota is what stopped it", async () => {
    const deliver = createResendDeliverer({
      apiKey: "re_test",
      minIntervalMs: 0,
      send: async () => ({
        data: null,
        error: {
          statusCode: 429,
          name: "daily_quota_exceeded",
          message: "You have exceeded your daily email sending quota.",
        },
      }),
    });
    const err = (await deliver(outbound()).catch((e: unknown) => e)) as ResendDeliveryError;
    expect(err.kind).toBe("paused");
    expect(err.message).toContain("[paused]");
    expect(err.message).toContain("daily_quota_exceeded");
    // NOT the throttle wording — a report that said "still refusing after 3
    // retries" would send somebody looking for a rate limit that is not there.
    expect(err.message).not.toContain("retries");
  });
});
