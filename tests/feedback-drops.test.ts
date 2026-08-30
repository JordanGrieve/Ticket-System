import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeDropReason } from "../lib/feedback-log";
import type { FeedbackDropReason } from "../db/schema";

/**
 * Unattributable bounces are counted, not just logged.
 *
 * ── THE FAILURE THIS GUARDS ──
 * The SES webhook drops feedback it cannot map to a campaign recipient. That
 * is correct — suppressing globally would let one tenant's bounce silence an
 * address for every other tenant — but until now the drop reached only
 * `console.warn`.
 *
 * Which means a systematic attribution failure is indistinguishable from clean
 * sending. If a deploy stopped recording provider message ids, every bounce
 * would quietly stop suppressing anybody, the campaign reports would still
 * look healthy, and the first symptom would be the shared domain's reputation
 * falling months later — for every tenant at once.
 *
 * These are mostly source-reading guards, because the interesting behaviour is
 * a database write inside a signature-verified webhook and CI has no
 * DATABASE_URL. What they protect is the WIRING: that both drop paths still
 * record, and that recording can never turn a handled notification into a 500.
 */

const WEBHOOK = readFileSync(
  join(process.cwd(), "app/api/webhooks/ses/route.ts"),
  "utf8",
);
const LOG = readFileSync(join(process.cwd(), "lib/feedback-log.ts"), "utf8");
const SCHEMA = readFileSync(join(process.cwd(), "db/schema.ts"), "utf8");

describe("both ways a bounce can go unattributed are recorded", () => {
  it("records when SES sends no message id", () => {
    expect(WEBHOOK).toMatch(/reason:\s*"no_message_id"/);
  });

  it("records when the message id matches no recipient row", () => {
    expect(WEBHOOK).toMatch(/reason:\s*"unmapped_message_id"/);
  });

  it("carries the message id on the unmapped path", () => {
    /*
     * A percentage is not something anybody can act on; one real SES id can be
     * traced through CloudWatch to the send that produced it. If this ever
     * stops being passed, the card in the admin console still shows a count
     * and quietly loses the only field that makes it actionable.
     */
    const at = WEBHOOK.indexOf('reason: "unmapped_message_id"');
    expect(at).toBeGreaterThan(-1);
    const call = WEBHOOK.slice(at, at + 220);
    expect(call).toContain("messageId: feedback.messageId");
  });

  it("still drops rather than suppressing — the recording changed nothing", () => {
    // The whole point is that behaviour is unchanged and only visibility is
    // added. A `continue` after the unmapped branch is what keeps it a drop.
    const at = WEBHOOK.indexOf("if (!outcome.matched)");
    expect(at).toBeGreaterThan(-1);

    /*
     * Bounded by the next line that ACTS on a bounce rather than by a brace
     * count — the first version sliced a fixed 400 characters and broke the
     * moment the branch grew by the recording call, which is a test that
     * fails for a reason unrelated to what it is checking.
     */
    const acted = WEBHOOK.indexOf("suppressed += 1", at);
    expect(acted).toBeGreaterThan(at);
    expect(WEBHOOK.slice(at, acted)).toContain("continue;");
  });
});

describe("recording can never break the webhook", () => {
  it("swallows its own errors", () => {
    /*
     * The 200 this endpoint returns tells Amazon the notification was handled.
     * If the logging write could throw, SNS would retry a bounce that was
     * already processed — a worse bug than the invisibility it was added to
     * fix. Same rule as lib/ingestion-log.ts.
     */
    expect(LOG).toMatch(/catch\s*\(err\)\s*\{[\s\S]*?console\.error/);
    // Both exported functions, not just one.
    expect((LOG.match(/catch \(err\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("reads return an empty list rather than throwing at the console", () => {
    expect(LOG).toContain("return [];");
  });
});

describe("the table cannot grow without bound", () => {
  it("aggregates on (reason, event_type) rather than appending", () => {
    // A row-per-event log would turn a deliverability incident into a database
    // incident at the exact moment thousands of events arrive.
    expect(LOG).toContain("onConflictDoUpdate");
    expect(SCHEMA).toContain("feedback_drops_reason_event_idx");
  });

  it("caps the provider-supplied fields that reach columns", () => {
    expect(LOG).toMatch(/eventType[\s\S]{0,80}\.slice\(0, 40\)/);
    expect(LOG).toMatch(/messageId[\s\S]{0,80}\.slice\(0, 200\)/);
  });

  it("keeps a traceable id rather than letting a blank overwrite it", () => {
    // A later event with no id must not erase the one example we had.
    expect(LOG).toContain("COALESCE");
  });
});

describe("no workspace is ever guessed", () => {
  it("the table has no workspace column at all", () => {
    /*
     * These are precisely the events for which no workspace could be
     * determined. A column would invite somebody to fill it, and a guessed
     * attribution is how a bounce ends up suppressing another tenant's
     * subscriber — the exact outcome dropping exists to prevent.
     */
    const at = SCHEMA.indexOf("export const feedbackDrops");
    expect(at).toBeGreaterThan(-1);
    const block = SCHEMA.slice(at, SCHEMA.indexOf("\n);", at));
    expect(block).not.toContain("workspaceId");
    expect(block).not.toContain("workspace_id");
  });
});

describe("what an operator is told", () => {
  const REASONS: FeedbackDropReason[] = ["no_message_id", "unmapped_message_id"];

  it("explains every reason", () => {
    for (const r of REASONS) {
      expect(describeDropReason(r).length).toBeGreaterThan(40);
    }
  });

  it("distinguishes the expected case from the alarming one", () => {
    /*
     * The two need opposite responses, and a console showing only a count
     * would leave an operator unable to tell a normal background rate from an
     * outage. unmapped_message_id is expected at low volume; no_message_id
     * never is.
     */
    expect(describeDropReason("unmapped_message_id")).toMatch(/expected/i);
    expect(describeDropReason("no_message_id")).toMatch(/always/i);
  });

  it("says what to look at rather than only what happened", () => {
    for (const r of REASONS) {
      expect(describeDropReason(r)).toMatch(
        /configuration|recording|suppress/i,
      );
    }
  });
});
