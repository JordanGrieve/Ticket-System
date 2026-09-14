import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Single opt-in: the shape of the endpoint, guarded by reading it.
 *
 * ── WHY SOURCE READING AND NOT BEHAVIOUR ──
 * The branch this covers writes a subscriber row and sends an email. CI has no
 * DATABASE_URL and no mail provider, and standing both up to assert "the
 * welcome went out" would be testing the fixtures. The decisions worth
 * protecting are structural — which path runs, in which order, with which
 * argument — and those are visible in the file. The one genuinely behavioural
 * part, what the consent record CLAIMS, is pure and is tested for real in
 * tests/subscribe.test.ts.
 *
 * ── WHAT THIS IS PROTECTING ──
 * Jordan, 14 Sep 2026: "if I hit subscribe I should not get a confirmation
 * email I need to click." The risk that came with granting it is not to the
 * client who asked — it is that campaigns for every workspace leave under one
 * sending domain, so one list of typos and stranger-typed addresses degrades
 * delivery for all of them. Three things hold that in check, and each one is
 * easy to remove by accident: the welcome email (which carries the way out
 * that is not the spam button), the per-workspace switch, and the rate limits.
 */

const ROUTE = readFileSync(
  join(process.cwd(), "app/api/subscribe/[key]/route.ts"),
  "utf8",
);
const SCHEMA = readFileSync(join(process.cwd(), "db/schema.ts"), "utf8");

/** The single opt-in branch, from its condition to the return. */
function singleOptInBranch(): string {
  const at = ROUTE.indexOf("if (!workspace.requireSignupConfirmation)");
  expect(at, "the endpoint no longer branches on the workspace setting").
    toBeGreaterThan(-1);
  const end = ROUTE.indexOf("return subscribed(", at);
  expect(end, "the single opt-in branch does not return a subscribed response").
    toBeGreaterThan(at);
  return ROUTE.slice(at, end);
}

describe("which path a workspace is on", () => {
  it("defaults to single opt-in", () => {
    const at = SCHEMA.indexOf("requireSignupConfirmation");
    expect(at).toBeGreaterThan(-1);
    const decl = SCHEMA.slice(at, at + 200);
    expect(decl).toContain('boolean("require_signup_confirmation")');
    expect(decl).toContain("default(false)");
    // notNull, or the branch below reads undefined for every workspace created
    // before the column existed — and `!undefined` is true, so they would all
    // silently land on single opt-in whatever the column said.
    expect(decl).toContain("notNull()");
  });

  it("is read from the workspace, never from the request", () => {
    /*
     * The submission is a POST from a public page whose key is published in
     * the client's own source. A `confirm=0` field honoured here would let a
     * stranger choose single opt-in for a workspace that is deliberately on
     * confirmation — which is the whole switch, defeated by a form field.
     */
    expect(ROUTE).toContain("workspace.requireSignupConfirmation");
    expect(ROUTE).not.toMatch(/fields\[["']\s*(confirm|double|optin)/i);
  });
});

describe("the single opt-in path", () => {
  it("writes the subscriber and says so was a single opt-in", () => {
    const branch = singleOptInBranch();
    expect(branch).toContain("confirmSubscription(");
    expect(branch).toMatch(/method:\s*"single"/);
  });

  it("records the submission's IP, not nothing", () => {
    // The consent record's IP has to describe the same act as its timestamp.
    // Under single opt-in the act is the submission, so this is the right one —
    // and dropping it leaves a consent record with no evidence of who acted.
    expect(singleOptInBranch()).toContain("consentIp: clientIp(req)");
  });

  it("sends the welcome email, which carries the way out", () => {
    /*
     * The safety valve, and the reason single opt-in is defensible on a shared
     * sending domain. The form is public: anybody can type somebody else's
     * address into it. The person who gets a welcome they did not ask for
     * needs an unsubscribe in front of them, because the alternative they
     * reach for is the spam button — and complaints are what cost every other
     * client their delivery.
     */
    expect(singleOptInBranch()).toContain("sendWelcomeEmail(");
  });

  it("does not mail a second welcome for an address already on the list", () => {
    // consentRecorded, not subscribed: re-submitting a form with an address
    // that is already subscribed records no fresh consent, and mailing them
    // again each time is how a form becomes a way to spam one person.
    expect(singleOptInBranch()).toContain("outcome.consentRecorded");
  });

  it("awaits the welcome rather than floating the promise", () => {
    // Vercel freezes the function when the response returns, so a floating
    // promise dies at an unpredictable point — sometimes after the provider
    // call, sometimes before. Same rule as the confirm route.
    expect(singleOptInBranch()).toContain("await sendWelcomeEmail(");
  });

  it("does not need the token secret", () => {
    /*
     * The secret check used to run before anything else and 503'd the whole
     * endpoint without it. Single opt-in mints no token, so a missing secret is
     * no longer a reason to refuse a signup that does not need one — and if the
     * check drifts back above the branch, every signup starts failing in an
     * environment that never needed the key.
     */
    const branchAt = ROUTE.indexOf("if (!workspace.requireSignupConfirmation)");
    const secretAt = ROUTE.indexOf("resolveSigningSecret()");
    expect(secretAt, "the signing secret is no longer resolved at all").
      toBeGreaterThan(-1);
    expect(
      secretAt,
      "the signing secret is checked before the single opt-in branch, so a workspace that needs no token is refused without one",
    ).toBeGreaterThan(branchAt);
  });
});

describe("the limits that bound a public write", () => {
  it("still rate-limits per workspace and per IP", () => {
    /*
     * These stopped being merely polite the moment this endpoint began writing
     * a row per POST. Unthrottled it is both a database-growth primitive and a
     * mail-bombing tool pointed at whatever address an attacker types, sent
     * from our domain.
     */
    expect(ROUTE).toContain("subscribe:ws:");
    expect(ROUTE).toContain("subscribe:ip:");
  });

  it("still checks the honeypot before anything else", () => {
    const honeypotAt = ROUTE.indexOf("isHoneypotTripped(fields)");
    const branchAt = ROUTE.indexOf("if (!workspace.requireSignupConfirmation)");
    expect(honeypotAt).toBeGreaterThan(-1);
    expect(honeypotAt).toBeLessThan(branchAt);
  });
});

/**
 * The endpoint has a PUBLISHED contract, on somebody else's website.
 *
 * The AI prompt on the Install page tells every integration what success looks
 * like, and those integrations are deployed where we cannot see them, cannot
 * change them, and get no report when they break. Anything the prompt has
 * promised is therefore a compatibility surface, not an implementation detail.
 *
 * This nearly went wrong within the hour: single opt-in first returned 200,
 * which is the more honest status, while every integration built from the old
 * prompt had been told success was "202 Accepted". An assistant that wrote
 * `res.status === 202` would have started showing a failure message to people
 * who had just successfully subscribed — on a client's live form, silently.
 */
describe("integrations built against the old prompt keep working", () => {
  it("still answers 2xx-with-202 on both paths", () => {
    // Both success responses, found by their message constants so this cannot
    // pass by matching a 202 somewhere unrelated in the file.
    for (const marker of ["SUBSCRIBED_MESSAGE", "ACCEPTED_MESSAGE"]) {
      const at = ROUTE.indexOf(`message: ${marker}`);
      expect(at, `${marker} is not returned anywhere`).toBeGreaterThan(-1);
      const nearby = ROUTE.slice(at, at + 300);
      expect(
        nearby,
        `the ${marker} response no longer returns 202 — every integration told "202 Accepted" by the prompt breaks silently`,
      ).toContain("status: 202");
    }
  });

  it("says which happened in the body, where a new field breaks nobody", () => {
    // The precise signal lives here rather than in the status code, because an
    // old integration that does not read this field cannot be misled by it.
    expect(ROUTE).toContain("subscribed: true");
    expect(ROUTE).toContain("subscribed: false");
  });

  it("keeps the endpoint shape the prompt documented", () => {
    // Same path, same key position, same CORS. A change to any of these is a
    // change to code on other people's websites.
    expect(ROUTE).toContain("CORS_HEADERS");
    expect(ROUTE).toContain("readSignupSubmission(fields)");
  });
});
