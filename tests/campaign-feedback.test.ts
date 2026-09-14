import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suppressionReasonFor } from "../lib/campaign-feedback";
import { shouldSuppressAddress } from "../lib/delivery-events";

/**
 * A campaign bounce or complaint stops the address being mailed again.
 *
 * ── THE GAP THIS CLOSES ──
 * Campaign feedback reached suppressions only through the SES webhook. SES was
 * never granted production access and was deleted on 14 Sep 2026, which left a
 * LIVE Resend campaign path with no feedback loop at all: every hard bounce
 * would be mailed again next month, and so would every complaint.
 *
 * The complaint case is the one with teeth. A complaint is a person pressing
 * "this is spam"; mailing them again afterwards is the most reliable way to
 * lose a sending domain — and the domain is shared, so the tenant who pays is
 * every other tenant.
 *
 * ── WHAT IS TESTED HOW ──
 * The write is two statements inside a signature-verified webhook and CI has
 * no DATABASE_URL, so the wiring is read as source in the same way
 * tests/feedback-drops.test.ts reads its own. The decisions that are pure —
 * which events count, and which suppression each one justifies — are executed.
 */

const ROUTE = readFileSync(
  join(process.cwd(), "app/api/webhooks/resend/route.ts"),
  "utf8",
);
const LIB = readFileSync(join(process.cwd(), "lib/campaign-feedback.ts"), "utf8");

describe("which events are grounds for never writing again", () => {
  it("a complaint always is", () => {
    // No bounce type on a complaint, and none needed: somebody said "spam".
    expect(shouldSuppressAddress("email.complained", null)).toBe(true);
  });

  it("a permanent bounce is, and a transient one is not", () => {
    expect(shouldSuppressAddress("email.bounced", "Permanent")).toBe(true);
    expect(shouldSuppressAddress("email.bounced", "Transient")).toBe(false);
    // "Undetermined" is Resend's third answer. Treating it as permanent would
    // cut somebody off on a maybe.
    expect(shouldSuppressAddress("email.bounced", "Undetermined")).toBe(false);
  });

  it("a delivery is not", () => {
    expect(shouldSuppressAddress("email.delivered", null)).toBe(false);
    expect(shouldSuppressAddress("email.sent", null)).toBe(false);
  });
});

describe("the two kinds of feedback are not the same fact", () => {
  it("a complaint is recorded as a complaint, not as a bounce", () => {
    /*
     * They are both suppressions and they mean different things: a hard bounce
     * is a fact about a mailbox, a complaint is a statement by a person. The
     * suppression list is the evidence a client would be shown if they ever
     * asked why an address stopped receiving, and collapsing the two would
     * make that answer wrong.
     */
    expect(suppressionReasonFor("complained")).toBe("complaint");
    expect(suppressionReasonFor("bounced")).toBe("hard_bounce");
  });
});

describe("the webhook tells campaign mail from transactional mail", () => {
  it("decides by matching a campaign recipient, not by reading the address", () => {
    /*
     * The `from` address would be the tempting discriminator and it is the
     * wrong one: it is attacker-supplied in a webhook body, and a forged event
     * naming the campaign sender would then suppress any address in any
     * workspace. The id is matched against a row we wrote ourselves at send
     * time, and the workspace comes from THAT row.
     */
    expect(ROUTE).toContain("applyCampaignFeedback(");
    expect(LIB).toContain("innerJoin(campaigns");
    expect(LIB).not.toMatch(/workspaceId:\s*(input|event|payload)\./);
  });

  it("suppresses before it updates the recipient row", () => {
    /*
     * Order chosen for what a crash between the two leaves behind. Suppressed
     * with the row still reading "sent" is a report that is slightly wrong;
     * the reverse is an address marked bounced that will be mailed again next
     * month, which is the failure this whole file exists to prevent.
     */
    const suppressAt = LIB.indexOf("await suppressAddress(");
    const updateAt = LIB.indexOf("update(campaignRecipients)");
    expect(suppressAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(suppressAt).toBeLessThan(updateAt);
  });

  it("does not let a late bounce overwrite a complaint", () => {
    // Both are terminal; the complaint is the more serious fact about the
    // address, so whichever arrived first stays.
    expect(LIB).toMatch(/NOT IN \('bounced', 'complained'\)/);
  });

  it("still refuses to suppress on a transactional bounce", () => {
    /*
     * The rule that was here before any of this: suppressions are the
     * NEWSLETTER list. A bounced ticket reply is between a business and their
     * own customer, and suppressing on it could stop them answering an open
     * enquiry.
     */
    const at = ROUTE.indexOf("if (feedback.matched)");
    expect(at).toBeGreaterThan(-1);
    const elseBranch = ROUTE.slice(at, at + 1200);
    expect(elseBranch).toContain("recordUnattributableFeedback(");
    expect(elseBranch).not.toContain("suppressAddress(");
  });
});

describe("feedback that fits nobody is counted", () => {
  it("records an event with no id at all", () => {
    // Never normal, whatever kind of mail it was about.
    const at = ROUTE.indexOf("if (!providerId)");
    expect(at).toBeGreaterThan(-1);
    expect(ROUTE.slice(at, at + 700)).toContain("recordUnattributableFeedback(");
  });

  it("does NOT count an id that belongs to a ticket message", () => {
    /*
     * The trap in reusing the SES rules here. Under SES this endpoint saw
     * campaign events only, so "no matching recipient" meant something was
     * wrong. Resend posts both kinds, so a bounced ticket reply legitimately
     * matches no campaign recipient — counting those would bury the real
     * signal in normal traffic inside a day.
     */
    const at = LIB.indexOf("export async function recordUnattributableFeedback");
    expect(at).toBeGreaterThan(-1);

    /*
     * Comments stripped before matching.
     *
     * The first version of this asserted the text `if (known) return;` and
     * passed with that exact line COMMENTED OUT — the characters were still
     * there, a slash in front of them. A guard that cannot tell code from
     * prose is the one AGENTS.md warns about: it reports on the file rather
     * than on the program.
     */
    const body = LIB.slice(at)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(body).toContain("ticketMessages");
    expect(body).toMatch(/if \(known\) return;/);
  });

  it("keeps the id on the unmapped path", () => {
    // A count nobody can trace is a number, not a diagnosis. One real id can
    // be looked up in the provider's dashboard.
    const at = LIB.indexOf('reason: "unmapped_message_id"');
    expect(at).toBeGreaterThan(-1);
    expect(LIB.slice(at, at + 200)).toContain("messageId: id");
  });
});
