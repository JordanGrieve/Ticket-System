import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RANK } from "../lib/delivery-events";

/**
 * app/api/webhooks/resend/route.ts, read as source.
 *
 * These are the properties that cannot be checked by running the handler
 * without a database, and they are the ones that matter: the route is PUBLIC
 * and it WRITES, so the signature is the entire authorisation.
 *
 * The repo's tenancy sweep does not cover this file. That sweep looks for raw
 * sql`` statements and this route uses the Drizzle query builder, so it is
 * silent here — and silence from a guard that never looked is not approval.
 * Hence this file.
 */

const SRC = readFileSync(
  join(process.cwd(), "app/api/webhooks/resend/route.ts"),
  "utf8",
);

describe("the Resend delivery webhook is not world-writable", () => {
  it("fails closed when no signing secret is configured", () => {
    // The inbound webhook shipped failing OPEN — with no secret set the check
    // was skipped entirely and anyone could POST fabricated mail into any
    // workspace. It was silent and the build was perfectly happy. The same
    // mistake here would let a stranger mark any message delivered, or bounced.
    //
    // Anchored on the guard BLOCK rather than a fixed character window: the
    // first version of this test read 220 characters after `if (!secret)` and
    // broke the moment the log message got longer, which is a test failing for
    // a reason that has nothing to do with the property it protects.
    expect(SRC).toMatch(/if \(!secret\) \{[\s\S]*?status: 503[\s\S]*?\n  \}/);
  });

  it("refuses before it reads the body", () => {
    // So an unconfigured deployment cannot be probed for behaviour.
    expect(SRC.indexOf("if (!secret)")).toBeLessThan(
      SRC.indexOf("await req.text()"),
    );
  });

  it("verifies the signature before it writes anything", () => {
    const verify = SRC.indexOf("verifySvixSignature(raw,");
    const write = SRC.indexOf(".update(ticketMessages)");
    expect(verify).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(verify);
    // …and the check must REFUSE, not merely run. A verifier whose result is
    // computed and then ignored is the failure this is really guarding against.
    expect(SRC).toMatch(/if \(!verifySvixSignature\(raw, req\.headers, secret\)\)/);
  });

  it("verifies the RAW body, not a reparsed one", () => {
    // Round-tripping the payload through JSON.parse and back invalidates a
    // perfectly good signature and looks like a provider fault.
    expect(SRC).toMatch(/const raw = await req\.text\(\)/);
    expect(SRC.indexOf("JSON.parse")).toBeGreaterThan(
      SRC.indexOf("verifySvixSignature(raw,"),
    );
  });

  it("prefers this endpoint's own signing secret", () => {
    // Resend issues a secret per webhook ENDPOINT. Delivery events are a
    // second endpoint from /api/inbound, so sharing one env var would reject
    // every event with a signature that is perfectly valid.
    expect(SRC).toMatch(/RESEND_DELIVERY_WEBHOOK_SIGNING_SECRET/);
  });
});

describe("the update is keyed by the provider's id", () => {
  it("always filters on provider_message_id", () => {
    // The id is globally unique and is what makes this safe without a
    // workspace predicate: the key IS the tenancy, exactly as for
    // noteProviderFeedback in lib/suppressions.ts. An update that lost this
    // predicate would rewrite delivery status across every workspace at once.
    expect(SRC).toMatch(/eq\(ticketMessages\.providerMessageId, providerId\)/);
  });

  it("refuses to act on an event with no email_id", () => {
    expect(SRC).toMatch(/if \(!providerId\)/);
  });
});

describe("the ordering rule has one source", () => {
  it("builds the SQL rank from RANK rather than hand-writing it", () => {
    // This was hand-written first. Two copies of an ordering is how one of
    // them rots: add a status, update the object, miss the SQL, and a bounced
    // message quietly reads "delivered".
    expect(SRC).toMatch(/Object\.entries\(RANK\)/);
    // A literal CASE listing the statuses would be the copy we are avoiding.
    expect(SRC).not.toMatch(/WHEN 'delivered' THEN/);
  });

  it("compares against RANK[next], so the rule cannot drift", () => {
    expect(SRC).toMatch(/RANK\[next\]/);
  });

  it("RANK still puts the terminal states above delivered", () => {
    // The SQL above is generated from this, so this ordering IS the database's
    // ordering. Pinned here because the generation makes that non-obvious.
    expect(RANK.bounced).toBeGreaterThan(RANK.delivered);
    expect(RANK.failed).toBeGreaterThan(RANK.delivered);
    expect(RANK.delivered).toBeGreaterThan(RANK.sent);
    expect(RANK.sent).toBeGreaterThan(RANK.queued);
  });
});

describe("it does not make Resend retry things it chose to ignore", () => {
  it("answers 200 to events it does not handle", () => {
    // A non-2xx makes Resend retry and eventually disable the endpoint, which
    // would take down the events we DO handle along with the ones we do not.
    const twoHundreds = SRC.match(/status:\s*200/g) ?? [];
    expect(twoHundreds.length).toBeGreaterThanOrEqual(2);
  });
});

describe("transactional bounces do not touch the newsletter suppression list", () => {
  it("does not write to suppressions", () => {
    // Deliberate. `suppressions` is the marketing opt-out list; adding a
    // support bounce to it could block a business replying to their own
    // customer's open enquiry. The route logs instead, so the gap is visible
    // rather than silent.
    expect(SRC).not.toMatch(/insert\(suppressions\)/);
    expect(SRC).toMatch(/not wired up/);
  });
});
