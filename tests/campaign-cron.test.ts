import { describe, expect, it } from "vitest";
import {
  authorizeCronRequest,
  envelopeFromEnv,
  planSweep,
  summariseSweep,
  sweepDeadlineReached,
  MAX_CAMPAIGNS_PER_SWEEP,
  RECIPIENTS_PER_SWEEP,
  SWEEP_DEADLINE_MS,
  type SweepCampaignOutcome,
} from "../lib/campaign-cron";

/**
 * Pure policy only — lib/campaign-cron.ts imports no database, so this suite
 * runs with no DATABASE_URL, like every other suite here.
 *
 * The authorisation block is the reason this file exists. The bug it guards
 * against (a missing secret silently disabling the check) is invisible in
 * review, compiles cleanly, and has already shipped once in this repo on
 * app/api/inbound/route.ts. An assertion is the only thing that notices.
 */

const SECRET = "s3cret-cron-token";

describe("authorizeCronRequest", () => {
  it("accepts Vercel's bearer header", () => {
    expect(authorizeCronRequest(`Bearer ${SECRET}`, SECRET)).toEqual({
      ok: true,
    });
  });

  it("FAILS CLOSED with 503 when the secret is not configured", () => {
    // The whole point. An unconfigured deployment must refuse everyone rather
    // than run unauthenticated — this endpoint sends email.
    for (const secret of [undefined, "", "   "]) {
      const result = authorizeCronRequest(`Bearer anything`, secret);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(503);
    }
  });

  it("refuses even a well-formed request when the secret is unset", () => {
    // Not "no secret means anything goes": no secret means nothing goes.
    const result = authorizeCronRequest("Bearer ", undefined);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing, empty or malformed Authorization header", () => {
    for (const header of [null, "", "   ", SECRET, `Basic ${SECRET}`, "Bearer"]) {
      const result = authorizeCronRequest(header, SECRET);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    }
  });

  it("rejects a wrong token, including near-misses and length mismatches", () => {
    for (const token of [
      "wrong",
      SECRET.slice(0, -1),
      `${SECRET}x`,
      SECRET.toUpperCase(),
      `${SECRET.slice(0, 4)} ${SECRET.slice(4)}`,
    ]) {
      const result = authorizeCronRequest(`Bearer ${token}`, SECRET);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    }
  });

  it("tolerates surrounding whitespace on the header and the secret", () => {
    // Leading/trailing OWS around a header value is not significant in HTTP,
    // and a secret pasted into a dashboard field routinely picks up a stray
    // space or newline. Trimming both ends is deliberate; nothing INSIDE the
    // token is normalised, which the near-miss case above pins down.
    for (const header of [
      `  Bearer ${SECRET}  `,
      `Bearer ${SECRET}\n`,
      `\tBearer ${SECRET}`,
    ]) {
      expect(authorizeCronRequest(header, `  ${SECRET}\n`)).toEqual({ ok: true });
    }
  });
});

describe("planSweep", () => {
  it("gives a single due campaign the whole row budget", () => {
    expect(planSweep(1).recipientsPerCampaign).toBe(RECIPIENTS_PER_SWEEP);
  });

  it("splits the budget across concurrent campaigns", () => {
    expect(planSweep(3).recipientsPerCampaign).toBe(
      Math.floor(RECIPIENTS_PER_SWEEP / 3),
    );
  });

  it("never lets the total exceed the row budget", () => {
    for (let due = 0; due <= 20; due += 1) {
      const plan = planSweep(due);
      const worked = Math.min(Math.max(due, 1), MAX_CAMPAIGNS_PER_SWEEP);
      expect(plan.recipientsPerCampaign * worked).toBeLessThanOrEqual(
        RECIPIENTS_PER_SWEEP,
      );
    }
  });

  it("caps how many campaigns one tick will touch", () => {
    expect(planSweep(500).campaignLimit).toBe(MAX_CAMPAIGNS_PER_SWEEP);
    expect(planSweep(500).recipientsPerCampaign).toBe(
      Math.floor(RECIPIENTS_PER_SWEEP / MAX_CAMPAIGNS_PER_SWEEP),
    );
  });

  it("never plans a zero-row batch", () => {
    // A limit of 0 would read no rows forever and the campaign would sit
    // `sending` for good with nothing anywhere saying why.
    for (const due of [0, 1, 7, 1000]) {
      expect(planSweep(due).recipientsPerCampaign).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("sweepDeadlineReached", () => {
  it("is false inside the window and true at or past it", () => {
    expect(sweepDeadlineReached(1_000, 1_000)).toBe(false);
    expect(sweepDeadlineReached(1_000, 1_000 + SWEEP_DEADLINE_MS - 1)).toBe(
      false,
    );
    expect(sweepDeadlineReached(1_000, 1_000 + SWEEP_DEADLINE_MS)).toBe(true);
  });

  it("leaves headroom inside the function's own limit", () => {
    // If the deadline were >= maxDuration the platform would kill the
    // invocation mid-row, which under claim-before-send drops an email.
    expect(SWEEP_DEADLINE_MS).toBeLessThan(60_000);
  });
});

function outcome(
  over: Partial<SweepCampaignOutcome> = {},
): SweepCampaignOutcome {
  return {
    campaignId: 1,
    workspaceId: 1,
    completed: false,
    result: {
      claimed: 10,
      delivered: 9,
      failed: 1,
      suppressed: 2,
      more: false,
    },
    ...over,
  };
}

describe("summariseSweep", () => {
  it("adds up the per-campaign numbers", () => {
    const summary = summariseSweep([
      outcome({ campaignId: 1 }),
      outcome({ campaignId: 2, completed: true }),
    ]);
    expect(summary).toMatchObject({
      campaigns: 2,
      claimed: 20,
      delivered: 18,
      failed: 2,
      suppressed: 4,
      completed: 1,
      errored: 0,
      more: false,
    });
  });

  it("reports `more` when any campaign still has queued rows", () => {
    const summary = summariseSweep([
      outcome(),
      outcome({ result: { ...outcome().result!, more: true } }),
    ]);
    expect(summary.more).toBe(true);
  });

  it("counts a thrown campaign as errored, not as failed recipients", () => {
    // `failed` is a deliverability number — recipients the provider rejected.
    // Folding a sweep crash into it makes the campaign report lie.
    const summary = summariseSweep([
      outcome({ result: null, error: "connection reset" }),
    ]);
    expect(summary.errored).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.delivered).toBe(0);
  });

  it("assumes a thrown campaign still has work left", () => {
    // Otherwise the log says `more: false` about a campaign nobody finished.
    expect(summariseSweep([outcome({ result: null })]).more).toBe(true);
  });

  it("is empty and settled for an empty sweep", () => {
    expect(summariseSweep([])).toMatchObject({ campaigns: 0, more: false });
  });
});

describe("envelopeFromEnv", () => {
  it("reads the marketing sender and the optional mailto", () => {
    const result = envelopeFromEnv({
      CAMPAIGN_FROM_ADDRESS: "news@news.postbox.help",
      CAMPAIGN_UNSUBSCRIBE_MAILTO: "unsubscribe@postbox.help",
    });
    expect(result).toEqual({
      ok: true,
      envelope: {
        from: "news@news.postbox.help",
        unsubscribeMailto: "unsubscribe@postbox.help",
      },
    });
  });

  it("omits the mailto when it is unset or blank", () => {
    // A List-Unsubscribe pointing at an unmonitored inbox is worse than none.
    for (const mailto of [undefined, "", "   "]) {
      const result = envelopeFromEnv({
        CAMPAIGN_FROM_ADDRESS: "news@news.postbox.help",
        CAMPAIGN_UNSUBSCRIBE_MAILTO: mailto,
      });
      expect(result.ok && result.envelope.unsubscribeMailto).toBe(null);
    }
  });

  it("refuses when the marketing sender is unset — no transactional fallback", () => {
    // Falling back to replies@postbox.help would put bulk marketing on the
    // primary domain that carries every tenant's ticket replies.
    for (const from of [undefined, "", "   "]) {
      const result = envelopeFromEnv({
        CAMPAIGN_FROM_ADDRESS: from,
        EMAIL_FROM_ADDRESS: "replies@postbox.help",
      });
      expect(result.ok).toBe(false);
    }
  });

  it("does not read EMAIL_FROM_ADDRESS at all", () => {
    const result = envelopeFromEnv({
      EMAIL_FROM_ADDRESS: "replies@postbox.help",
    });
    expect(result.ok).toBe(false);
  });
});
