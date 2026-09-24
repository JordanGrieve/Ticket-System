import { describe, it, expect, vi } from "vitest";
import {
  createCampaignDeliverer,
  deliveryModeFromEnv,
  isLiveDeliveryMode,

  resendConfigFromEnv,
  DELIVERY_MODE_ENV,

  RESEND_DELIVERY_MODE,
  type DeliveryEnv,
} from "../lib/deliver";
import {
  createLogDeliverer,
  describeDelivery,
  formatDeliveryLog,
  hasOneClickUnsubscribe,
  NOT_SENT_ID_PREFIX,
  type DeliveryLogRecord,
} from "../lib/deliver-log";
import type { OutboundCampaignEmail } from "../lib/campaign-send";

/**
 * The factory's default, proved without a database and without a network.
 *
 * These tests import lib/deliver, which type-imports lib/campaign-send and
 * therefore never reaches db/index.ts (which throws at import time with no
 * DATABASE_URL).
 *
 * The thing under test is the one that matters: this codebase is one function
 * argument away from emailing real people, and the ONLY thing standing in the
 * way is that `createCampaignDeliverer` returns the log deliverer unless
 * CAMPAIGN_DELIVERY_MODE is exactly "resend".
 */

function outbound(
  overrides: Partial<OutboundCampaignEmail> = {},
): OutboundCampaignEmail {
  return {
    to: "sam@example.com",
    from: "Acme <news@news.postbox.help>",
    subject: "Hello there",
    text: "Body text",
    html: "<p>Body text</p>",
    headers: {
      "List-Unsubscribe":
        "<mailto:unsub@postbox.help>, <https://postbox.help/u/TOKEN>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    ...overrides,
  };
}

describe("deliveryModeFromEnv — the opt-in is exact, and absent by default", () => {
  it("is 'log' when the variable is not set at all", () => {
    expect(deliveryModeFromEnv({})).toBe("log");
  });

  it("is 'log' for every near-miss value", () => {
    const nearMisses = [
      "",
      " ",
      "SES",
      "Ses",
      "aws",
      "amazon",
      "true",
      "1",
      "yes",
      "on",
      "production",
      "ses,log",
      "not-ses",
      "Resend",
      "RESEND",
      "resend-api",
      "re_send",
      "resend,ses",
    ];
    for (const value of nearMisses) {
      expect(deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: value })).toBe("log");
    }
  });

  it("is 'log' for 'ses', which used to be a live provider", () => {
    /*
     * The retired mode, kept as a case on purpose.
     *
     * SES was removed on 14 Sep 2026 ("we are not using amazon anymore"), and
     * an environment somewhere may still carry CAMPAIGN_DELIVERY_MODE=ses. The
     * safe reading of a mode we no longer implement is "send nothing" — the
     * alternative is a factory that throws on every sweep, or worse, one that
     * finds some other provider to use instead. This pins which.
     */
    expect(deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: "ses" })).toBe("log");
    expect(deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: " ses " })).toBe("log");
  });

  it("is 'resend' only for the exact literal", () => {
    expect(
      deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: RESEND_DELIVERY_MODE }),
    ).toBe("resend");
    expect(deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: " resend " })).toBe(
      "resend",
    );
  });

  it("ignores every other environment variable, including both providers' credentials", () => {
    /*
     * Credentials in the environment must NOT be read as consent to send.
     *
     * RESEND_API_KEY is the sharper edge of the two: it is set in EVERY
     * environment, including local development, because every ticket
     * acknowledgement goes through it. If its presence selected the provider,
     * then `CAMPAIGN_DELIVERY_MODE` would not be a gate at all and a laptop
     * running the sweep against production data would mail a real subscriber
     * list.
     */
    const env: DeliveryEnv = {
      AWS_REGION: "eu-west-1",
      AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret",
      SES_CONFIGURATION_SET: "postbox-campaigns",
      SES_TENANT_NAME: "workspace-1",
      RESEND_API_KEY: "re_a_real_looking_key",
      NODE_ENV: "production",
    };
    expect(deliveryModeFromEnv(env)).toBe("log");
  });
});

describe("which modes actually transmit", () => {
  it("says log does not and the provider does", () => {
    expect(isLiveDeliveryMode("log")).toBe(false);
    expect(isLiveDeliveryMode("resend")).toBe(true);
  });
});

describe("createCampaignDeliverer — defaults to the log deliverer", () => {
  it("returns something that records rather than sends, on an empty env", async () => {
    const records: DeliveryLogRecord[] = [];
    const deliver = createCampaignDeliverer({
      env: {},
      sink: (r) => records.push(r),
    });

    const result = await deliver(outbound());

    expect(records).toHaveLength(1);
    expect(records[0].to).toBe("sam@example.com");
    expect(result.id).toMatch(new RegExp(`^${NOT_SENT_ID_PREFIX}`));
  });

  it("still defaults to log with a live RESEND_API_KEY present", async () => {
    // The key is present in every environment for transactional mail. This is
    // the test that proves it cannot, on its own, start a mailout.
    const records: DeliveryLogRecord[] = [];
    const deliver = createCampaignDeliverer({
      env: { RESEND_API_KEY: "re_a_real_looking_key" },
      sink: (r) => records.push(r),
    });
    const result = await deliver(outbound());
    expect(records).toHaveLength(1);
    expect(result.id).toMatch(new RegExp(`^${NOT_SENT_ID_PREFIX}`));
  });

  it("logs for a retired mode rather than throwing or guessing", async () => {
    /*
     * CAMPAIGN_DELIVERY_MODE=ses with the whole AWS block beside it: an
     * environment left exactly as it was before 14 Sep 2026, when SES was
     * removed. It must send nothing, quietly.
     *
     * The two alternatives are both worse. Throwing turns a stale variable
     * into an hourly failing sweep. Reaching for whatever provider IS
     * configured — RESEND_API_KEY is present in every environment — would mean
     * a deployment nobody touched starting to mail real subscribers.
     */
    const records: DeliveryLogRecord[] = [];
    const deliver = createCampaignDeliverer({
      env: {
        [DELIVERY_MODE_ENV]: "ses",
        AWS_REGION: "eu-west-1",
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
        SES_CONFIGURATION_SET: "postbox-campaigns",
        RESEND_API_KEY: "re_a_real_looking_key",
      },
      sink: (r) => records.push(r),
    });
    const result = await deliver(outbound());
    expect(records).toHaveLength(1);
    expect(result.id).toMatch(new RegExp(`^${NOT_SENT_ID_PREFIX}`));
  });
});

describe("createCampaignDeliverer — the resend mode", () => {
  it("REFUSES to construct rather than silently logging when the key is absent", () => {
    expect(() =>
      createCampaignDeliverer({ env: { [DELIVERY_MODE_ENV]: "resend" } }),
    ).toThrow(/Resend is not configured/);
  });

  it("REFUSES the placeholder key, which would look exactly like a working one", () => {
    // .env.example ships `re_placeholder` so the app boots. lib/email.ts
    // refuses it for the transactional path; a campaign that "sent" against it
    // would mark every recipient delivered and mail nobody.
    expect(() =>
      createCampaignDeliverer({
        env: { [DELIVERY_MODE_ENV]: "resend", RESEND_API_KEY: "re_placeholder" },
      }),
    ).toThrow(/placeholder/);
  });

  it("constructs with the flag AND a key, and says so out loud", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deliver = createCampaignDeliverer({
        env: { [DELIVERY_MODE_ENV]: "resend", RESEND_API_KEY: "re_live_key" },
        onSent: () => {},
      });
      expect(typeof deliver).toBe("function");
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain("REAL bulk");
      // The warning has to name the consequence that is easiest to miss:
      // campaigns and ticket acknowledgements spend the SAME allowance.
      expect(line).toContain("SAME Resend allowance");
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when it was built with no send counter, rather than counting nothing quietly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createCampaignDeliverer({
        env: { [DELIVERY_MODE_ENV]: "resend", RESEND_API_KEY: "re_live_key" },
      });
      expect(String(warn.mock.calls[0][0])).toContain("no send counter");
    } finally {
      warn.mockRestore();
    }
  });

  it("does not touch AWS at all in resend mode", () => {
    // An incomplete SES configuration must not stop a Resend send. These were
    // one function with one credentials check once, and that is exactly how a
    // provider switch turns into an outage.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        createCampaignDeliverer({
          env: {
            [DELIVERY_MODE_ENV]: "resend",
            RESEND_API_KEY: "re_live_key",
            AWS_ACCESS_KEY_ID: "",
          },
        }),
      ).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("resendConfigFromEnv", () => {
  it("names the one variable it needs when it is absent", () => {
    const result = resendConfigFromEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["RESEND_API_KEY"]);
  });

  it("treats whitespace as absent", () => {
    expect(resendConfigFromEnv({ RESEND_API_KEY: "   " }).ok).toBe(false);
  });

  it("reads the SAME key the transactional path uses, not a second one", () => {
    // The rate limit and the quota are per TEAM, not per key, so a separate
    // campaign key would buy no isolation and add a secret to rotate.
    const result = resendConfigFromEnv({ RESEND_API_KEY: " re_live_key " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.apiKey).toBe("re_live_key");
  });
});


describe("the log deliverer", () => {
  it("records recipient, subject, part sizes and headers", async () => {
    const records: DeliveryLogRecord[] = [];
    const deliver = createLogDeliverer({
      sink: (r) => records.push(r),
      idFactory: () => "fixed",
      now: () => new Date("2026-08-18T09:00:00.000Z"),
    });

    await deliver(outbound({ text: "abcde", html: "<p>abcde</p>" }));

    expect(records[0]).toMatchObject({
      messageId: "not-sent-fixed",
      to: "sam@example.com",
      from: "Acme <news@news.postbox.help>",
      subject: "Hello there",
      textBytes: 5,
      htmlBytes: 12,
      hasOneClickUnsubscribe: true,
    });
    expect(records[0].headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
  });

  it("measures BYTES, not characters", async () => {
    const records: DeliveryLogRecord[] = [];
    const deliver = createLogDeliverer({ sink: (r) => records.push(r) });
    // "£" is one character and two bytes. Providers reject on bytes.
    await deliver(outbound({ text: "£", html: "£" }));
    expect(records[0].textBytes).toBe(2);
  });

  it("returns a synthetic id that could never be mistaken for a provider's", async () => {
    const deliver = createLogDeliverer({ sink: () => {} });
    const a = await deliver(outbound());
    const b = await deliver(outbound());
    expect(a.id).toMatch(/^not-sent-/);
    expect(b.id).toMatch(/^not-sent-/);
    expect(a.id).not.toBe(b.id);
  });

  it("does not record the rendered body — only its size", async () => {
    const records: DeliveryLogRecord[] = [];
    const deliver = createLogDeliverer({ sink: (r) => records.push(r) });
    await deliver(outbound({ text: "SECRET-MERGE-VALUE", html: "SECRET" }));
    expect(JSON.stringify(records[0])).not.toContain("SECRET");
  });

  it("copies the headers rather than aliasing the caller's object", async () => {
    const records: DeliveryLogRecord[] = [];
    const deliver = createLogDeliverer({ sink: (r) => records.push(r) });
    const email = outbound();
    await deliver(email);
    email.headers["List-Unsubscribe"] = "MUTATED";
    expect(records[0].headers["List-Unsubscribe"]).not.toBe("MUTATED");
  });

  it("never throws — it is the default, and a flaky default is a fake outage", async () => {
    const deliver = createLogDeliverer({ sink: () => {} });
    for (let i = 0; i < 50; i++) {
      await expect(deliver(outbound())).resolves.toBeTruthy();
    }
  });

  it("leads its log line with the fact that nothing was sent", () => {
    const record = describeDelivery(
      outbound(),
      "not-sent-x",
      new Date("2026-08-18T09:00:00.000Z"),
    );
    const line = formatDeliveryLog(record);
    expect(line).toContain("NOT SENT");
    expect(line).toContain("no provider configured");
  });

  it("shouts when the one-click unsubscribe headers are missing", () => {
    const record = describeDelivery(
      outbound({ headers: {} }),
      "not-sent-x",
      new Date(),
    );
    expect(record.hasOneClickUnsubscribe).toBe(false);
    expect(formatDeliveryLog(record)).toContain("NO ONE-CLICK UNSUBSCRIBE");
  });
});

describe("hasOneClickUnsubscribe", () => {
  it("requires BOTH headers — List-Unsubscribe alone is only a hint", () => {
    expect(
      hasOneClickUnsubscribe({ "List-Unsubscribe": "<https://x/u/T>" }),
    ).toBe(false);
    expect(
      hasOneClickUnsubscribe({
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }),
    ).toBe(false);
    expect(
      hasOneClickUnsubscribe({
        "List-Unsubscribe": "<https://x/u/T>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }),
    ).toBe(true);
  });

  it("is case-insensitive about header names, as the RFC is", () => {
    expect(
      hasOneClickUnsubscribe({
        "list-unsubscribe": "<https://x/u/T>",
        "LIST-UNSUBSCRIBE-POST": "List-Unsubscribe=One-Click",
      }),
    ).toBe(true);
  });

  it("treats an empty value as absent", () => {
    expect(
      hasOneClickUnsubscribe({
        "List-Unsubscribe": "  ",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }),
    ).toBe(false);
  });
});
