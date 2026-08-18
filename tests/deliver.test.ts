import { describe, it, expect, vi } from "vitest";
import {
  createCampaignDeliverer,
  deliveryModeFromEnv,
  sesConfigFromEnv,
  DELIVERY_MODE_ENV,
  SES_DELIVERY_MODE,
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
 * DATABASE_URL). Nothing here calls fetch, and the SES branch is only ever
 * exercised through a config that is deliberately incomplete, so no request
 * can be constructed even by accident.
 *
 * The thing under test is the one that matters: this codebase is one function
 * argument away from emailing real people, and the ONLY thing standing in the
 * way is that `createCampaignDeliverer` returns the log deliverer unless
 * CAMPAIGN_DELIVERY_MODE is exactly "ses".
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
    ];
    for (const value of nearMisses) {
      expect(deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: value })).toBe("log");
    }
  });

  it("is 'ses' only for the exact literal", () => {
    expect(deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: SES_DELIVERY_MODE })).toBe(
      "ses",
    );
    // Surrounding whitespace is trimmed — a value pasted into a dashboard with
    // a trailing space is still a deliberate act of typing "ses".
    expect(deliveryModeFromEnv({ [DELIVERY_MODE_ENV]: " ses " })).toBe("ses");
  });

  it("ignores every other environment variable, including AWS credentials", () => {
    // Having AWS credentials in the environment must NOT be read as consent to
    // send. A Vercel project with an unrelated S3 integration would otherwise
    // start mailing people.
    const env: DeliveryEnv = {
      AWS_REGION: "eu-west-1",
      AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret",
      SES_CONFIGURATION_SET: "postbox-campaigns",
      SES_TENANT_NAME: "workspace-1",
      NODE_ENV: "production",
    };
    expect(deliveryModeFromEnv(env)).toBe("log");
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

  it("still defaults to log with a complete SES configuration present", async () => {
    const records: DeliveryLogRecord[] = [];
    const deliver = createCampaignDeliverer({
      env: {
        AWS_REGION: "eu-west-1",
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
        SES_CONFIGURATION_SET: "postbox-campaigns",
      },
      sink: (r) => records.push(r),
    });
    await deliver(outbound());
    expect(records).toHaveLength(1);
  });

  it("REFUSES to construct rather than silently logging when mode=ses is misconfigured", () => {
    // Falling back to the log deliverer here would be the worst of both: an
    // operator who believes they launched a live send watches every recipient
    // march to `sent` with a synthetic id and no email arrives.
    expect(() =>
      createCampaignDeliverer({ env: { [DELIVERY_MODE_ENV]: "ses" } }),
    ).toThrow(/SES is not configured/);
  });

  it("names every missing variable so the fix is one read of the error", () => {
    let message = "";
    try {
      createCampaignDeliverer({ env: { [DELIVERY_MODE_ENV]: "ses" } });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("SES_REGION");
    expect(message).toContain("AWS_ACCESS_KEY_ID");
    expect(message).toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("constructs an SES deliverer only with the flag AND full credentials", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deliver = createCampaignDeliverer({
        env: {
          [DELIVERY_MODE_ENV]: "ses",
          SES_REGION: "eu-west-1",
          AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
          AWS_SECRET_ACCESS_KEY: "secret",
        },
      });
      expect(typeof deliver).toBe("function");
      // Constructing is loud. This line in production logs is the signal that
      // the safety catch has been released.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("REAL bulk email");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("sesConfigFromEnv", () => {
  it("reports exactly which required variables are absent", () => {
    const result = sesConfigFromEnv({ SES_REGION: "eu-west-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual([
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
      ]);
    }
  });

  it("accepts SES_REGION or AWS_REGION, preferring the specific one", () => {
    const result = sesConfigFromEnv({
      SES_REGION: "eu-west-1",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "k",
      AWS_SECRET_ACCESS_KEY: "s",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.region).toBe("eu-west-1");
  });

  it("leaves the optional identifiers null rather than inventing them", () => {
    const result = sesConfigFromEnv({
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "k",
      AWS_SECRET_ACCESS_KEY: "s",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.configurationSetName).toBeNull();
      expect(result.config.tenantName).toBeNull();
      expect(result.config.returnPath).toBeNull();
    }
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
