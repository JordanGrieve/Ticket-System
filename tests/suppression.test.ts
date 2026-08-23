import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  looksLikeUnsubscribeToken,
  normaliseEmail,
  selectAudience,
  sendability,
  statusForSuppressionReason,
  unsubscribeUrl,
  type AudienceCandidate,
} from "../lib/newsletter";
import type { SubscriberStatus, SuppressionReason } from "../db/schema";

/**
 * The suppression rule, proved without a database.
 *
 * `suppressions` is authoritative: it outranks `subscribers.status` in every
 * direction, because the two are written by different events and drift — a
 * re-imported CSV sets a bounced address back to 'subscribed' and cannot touch
 * the suppression, which is keyed by email and survives the subscriber row
 * being deleted. Getting the precedence backwards means mailing an address
 * that hard-bounced or reported us for spam, and on a shared sending domain
 * that is charged to every other tenant's transactional support mail.
 *
 * Pure only: these import lib/newsletter and db/schema TYPES, so they run with
 * no DATABASE_URL. The SQL half of the enforcement (the LEFT JOINs inside the
 * materialise and claim statements in lib/campaign-send.ts) cannot be reached
 * from here — see the note at the bottom of this file.
 */

const ALL_STATUSES: SubscriberStatus[] = [
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
];

const ALL_REASONS: SuppressionReason[] = ["hard_bounce", "complaint", "manual"];

describe("sendability — suppression outranks subscriber status", () => {
  it("blocks a suppressed address whatever the subscriber row claims", () => {
    for (const status of ALL_STATUSES) {
      const verdict = sendability(status, true);
      expect(verdict.sendable).toBe(false);
      // Reported as "suppressed" rather than as the status, so the composer
      // tells the client the truth about WHY someone was skipped.
      expect(verdict).toEqual({ sendable: false, reason: "suppressed" });
    }
  });

  it("is the ONLY thing that lets a send through: subscribed and unsuppressed", () => {
    const sendable = ALL_STATUSES.filter(
      (s) => sendability(s, false).sendable,
    );
    expect(sendable).toEqual(["subscribed"]);
  });

  it("keeps each non-subscribed status distinguishable in the report", () => {
    expect(sendability("unsubscribed", false)).toEqual({
      sendable: false,
      reason: "unsubscribed",
    });
    expect(sendability("bounced", false)).toEqual({
      sendable: false,
      reason: "bounced",
    });
    expect(sendability("complained", false)).toEqual({
      sendable: false,
      reason: "complained",
    });
  });

  it("never throws for any status/suppression pair", () => {
    for (const status of ALL_STATUSES) {
      for (const suppressed of [true, false]) {
        expect(() => sendability(status, suppressed)).not.toThrow();
      }
    }
  });
});

describe("selectAudience agrees with sendability", () => {
  function sub(
    id: number,
    email: string,
    overrides: Partial<AudienceCandidate> = {},
  ): AudienceCandidate {
    // Consented by default: this block is about suppression-vs-status, and
    // `no_consent` is checked ahead of both, so an unset consentAt would make
    // every assertion below pass for the wrong reason. Consent's own ordering
    // is asserted in tests/newsletter-audience.test.ts.
    return {
      subscriberId: id,
      email,
      name: null,
      status: "subscribed",
      consentAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  it("uses the same rule for every status, with and without a suppression", () => {
    // The composer preview and the write path both run selectAudience, so if
    // it ever stopped delegating to sendability the two could disagree about
    // who gets mailed while still passing their own tests.
    for (const status of ALL_STATUSES) {
      const suppressedRun = selectAudience(
        [sub(1, "a@x.com", { status })],
        ["a@x.com"],
      );
      expect(suppressedRun.members).toHaveLength(0);
      expect(suppressedRun.skipped.suppressed).toBe(1);

      const cleanRun = selectAudience([sub(1, "a@x.com", { status })], []);
      const expected = sendability(status, false);
      expect(cleanRun.members).toHaveLength(expected.sendable ? 1 : 0);
      if (!expected.sendable) {
        expect(cleanRun.skipped[expected.reason]).toBe(1);
      }
    }
  });

  it("a fresh import cannot resurrect a suppressed address", () => {
    // The exact shape of the bug this table exists to prevent: someone
    // complained, the client re-uploaded their CSV, and every subscriber row
    // now says 'subscribed' again.
    const reimported = [
      sub(10, "angry@x.com", { status: "subscribed" }),
      sub(11, "fine@x.com", { status: "subscribed" }),
    ];
    const r = selectAudience(reimported, ["angry@x.com"]);
    expect(r.members.map((m) => m.email)).toEqual(["fine@x.com"]);
    expect(r.skipped.suppressed).toBe(1);
  });

  it("counts one suppressed person once, not once per list they are on", () => {
    // Dedup runs before filtering, so the skip counts are counts of PEOPLE.
    const r = selectAudience(
      [sub(1, "a@x.com"), sub(1, "a@x.com"), sub(2, "A@x.com")],
      ["a@x.com"],
    );
    expect(r.skipped.suppressed).toBe(1);
    expect(r.skipped.duplicate).toBe(2);
    expect(r.members).toHaveLength(0);
  });
});

describe("statusForSuppressionReason — the reconciliation mapping", () => {
  it("maps each reason to the status that preserves why the block exists", () => {
    expect(statusForSuppressionReason("hard_bounce")).toBe("bounced");
    expect(statusForSuppressionReason("complaint")).toBe("complained");
    // Unsubscribes are recorded as 'manual': db/schema.ts has no
    // 'unsubscribe' reason, and the provenance lives in the note.
    expect(statusForSuppressionReason("manual")).toBe("unsubscribed");
  });

  it("never maps a reason to 'subscribed'", () => {
    // A suppression that implied a sendable status would un-block someone.
    for (const reason of ALL_REASONS) {
      expect(statusForSuppressionReason(reason)).not.toBe("subscribed");
    }
  });

  it("is total over SuppressionReason", () => {
    for (const reason of ALL_REASONS) {
      expect(() => statusForSuppressionReason(reason)).not.toThrow();
    }
  });
});

describe("unsubscribe token handling", () => {
  it("accepts the tokens generateUnsubscribeToken actually produces", () => {
    // 32 hex characters (16 random bytes).
    expect(looksLikeUnsubscribeToken("a".repeat(32))).toBe(true);
    expect(looksLikeUnsubscribeToken("0f9c1d2e3b4a5968770615243342516f")).toBe(
      true,
    );
  });

  it("rejects junk before it reaches the database", () => {
    expect(looksLikeUnsubscribeToken("")).toBe(false);
    expect(looksLikeUnsubscribeToken("short")).toBe(false);
    expect(looksLikeUnsubscribeToken("../../etc/passwd")).toBe(false);
    expect(looksLikeUnsubscribeToken("a'; DROP TABLE suppressions; --")).toBe(
      false,
    );
    expect(looksLikeUnsubscribeToken("x".repeat(129))).toBe(false);
    expect(looksLikeUnsubscribeToken("abc def ghi jkl")).toBe(false);
  });

  it("is lenient about shape, because rejecting a real token is a breach", () => {
    // A token already sitting in somebody's inbox must keep working even if
    // the generator's alphabet or width changes. The database lookup is the
    // authority; this check only keeps obvious noise out of a query.
    expect(looksLikeUnsubscribeToken("AbCd-1234_efGH")).toBe(true);
  });

  it("round-trips through the URL the List-Unsubscribe header advertises", () => {
    const token = "0f9c1d2e3b4a5968770615243342516f";
    const url = unsubscribeUrl("https://postbox.help/", token);
    expect(url).toBe(`https://postbox.help/u/${token}`);
    // The path segment the route handler will see, unescaped, is the token
    // that was minted — so a token that survives the header survives the trip.
    const last = new URL(url).pathname.split("/").pop()!;
    expect(decodeURIComponent(last)).toBe(token);
    expect(looksLikeUnsubscribeToken(decodeURIComponent(last))).toBe(true);
  });
});

describe("address canonicalisation at the suppression boundary", () => {
  it("folds case and whitespace, so a capitalised re-import still matches", () => {
    expect(normaliseEmail("  Bob@Example.COM ")).toBe("bob@example.com");
  });

  it("does not fold plus-tags or dots into a different mailbox", () => {
    // Blocking bob@ because bob+news@ complained would silence a mailbox that
    // never asked to be silenced; the reverse would mail one that did.
    expect(normaliseEmail("bob+news@x.com")).toBe("bob+news@x.com");
    expect(normaliseEmail("b.ob@x.com")).toBe("b.ob@x.com");
  });
});

/*
 * NOT COVERED HERE, and deliberately so:
 *
 *  - the LEFT JOIN in materialiseAudience and the NOT EXISTS in the claim
 *    UPDATE (lib/campaign-send.ts), and every statement in lib/suppressions.ts.
 *    They are the real enforcement — application-level filtering is one
 *    forgotten caller away from a send — but they are SQL, and reaching them
 *    needs a DATABASE_URL, which CI does not have and must not need.
 *    Verifying them requires running the statements against a real Postgres.
 */

describe("an unsubscribe records WHICH campaign it came from", () => {
  /*
   * Static assertions over lib/suppressions.ts, in the style of the other
   * source-reading guards here: the statement needs a database and CI has no
   * DATABASE_URL.
   *
   * ── WHY THIS IS PINNED ──
   * PIVOT 21 proposed replacing the per-recipient unsubscribe token with a
   * stable per-subscriber one and using that for List-Unsubscribe. It was
   * declined (the reasoning is on unsubscribeUrl in lib/newsletter.ts), and
   * this test exists because the proposal is a plausible-looking tidy-up that
   * would quietly destroy something valuable.
   *
   * The attribution only works because the token resolves through
   * campaign_recipients to a campaign. A subscriber-level token cannot say
   * which message somebody was reading when they left — and since one-click
   * is most unsubscribes, switching would blind us to nearly all of it.
   *
   * If somebody does make that change, this fails and they have to read why.
   */
  const SUPPRESSIONS = readFileSync(
    join(process.cwd(), "lib/suppressions.ts"),
    "utf8",
  );

  it("resolves the token through campaign_recipients, not subscribers", () => {
    expect(SUPPRESSIONS).toMatch(/FROM campaign_recipients cr/);
    expect(SUPPRESSIONS).toMatch(/cr\.unsubscribe_token = \$\{token\}/);
  });

  it("writes the campaign id into the suppression note", () => {
    // Without this the note says only "unsubscribed", and a client asking
    // "which email made them leave?" has no answer.
    expect(SUPPRESSIONS).toMatch(/campaign #/);
    expect(SUPPRESSIONS).toMatch(/campaign_id::text/);
  });

  it("distinguishes one-click from a footer click in the note", () => {
    // Different provenance, and worth telling apart: a one-click unsubscribe
    // is a mail client acting on somebody's behalf, a footer click is the
    // person themselves.
    expect(SUPPRESSIONS).toMatch(/RFC 8058/);
    expect(SUPPRESSIONS).toMatch(/link in a campaign email/);
  });

  it("derives the workspace from the campaign, never from the request", () => {
    expect(SUPPRESSIONS).toMatch(/JOIN campaigns c ON c\.id = cr\.campaign_id/);
    expect(SUPPRESSIONS).toMatch(/c\.workspace_id\s+AS workspace_id/);
  });
});
