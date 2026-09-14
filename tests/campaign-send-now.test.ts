import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Send now" means now, not "within the hour".
 *
 * ── WHY IT CHANGED ──
 * Arming a campaign wrote two columns and left the sending to the sweep, which
 * is HOURLY. For a list of three that is up to fifty-nine minutes of looking at
 * a page wondering whether anything happened. Jordan, 14 Sep 2026: "so wait,
 * when I send it out, it's not straight away, but a set time?"
 *
 * ── WHY NOT JUST RUN THE CRON MORE OFTEN ──
 * Because that is the expensive fix and this one is free. Every scheduled tick
 * wakes the Neon compute for the autosuspend window whether or not there is
 * work; five-minute sweeps run at roughly 180 CU-hours against a 100-hour
 * allowance, and Neon Free answers an overage by SUSPENDING the compute — so
 * the failure mode of a chattier cron is the whole product going down.
 * Sending inside a request somebody just made adds no scheduled wakes at all.
 *
 * ── WHAT IS TESTED HOW ──
 * The send is a loop over provider calls behind a database claim, and CI has
 * no DATABASE_URL, so these read the wiring. The properties they protect are
 * the ones that would be silently wrong: that the pass is restricted to the
 * campaign just armed, that it cannot fail the request, and that the cron and
 * the button run the SAME loop rather than two that drift.
 */

const SCHEDULE = readFileSync(
  join(process.cwd(), "app/api/campaigns/[id]/schedule/route.ts"),
  "utf8",
);
const CRON = readFileSync(
  join(process.cwd(), "app/api/cron/campaigns/route.ts"),
  "utf8",
);
const RUNNER = readFileSync(
  join(process.cwd(), "lib/campaign-sweep-run.ts"),
  "utf8",
);

describe("one send loop, two callers", () => {
  it("the cron runs the shared loop rather than its own", () => {
    /*
     * The loop used to live in the cron route. A second copy in the schedule
     * route would have to repeat claim-before-send, per-campaign settling, and
     * the try/catch that stops one tenant's bad row abandoning another's send
     * — and would eventually stop repeating one of them.
     */
    expect(CRON).toContain("runCampaignSweep(");
    expect(CRON).not.toContain("sendCampaignBatch(");
    expect(CRON).not.toContain("claimDueCampaigns(");
  });

  it("the button runs the same one", () => {
    expect(SCHEDULE).toContain("runCampaignSweep(");
    expect(SCHEDULE).not.toContain("sendCampaignBatch(");
  });

  it("and the loop still settles every campaign it touches", () => {
    // The half that is easy to lose in a move: without it a campaign drains
    // its rows and never reaches `sent`, so it is swept again for ever.
    expect(RUNNER).toContain("settleCampaign(");
  });
});

describe("the inline pass is bounded", () => {
  it("sends only the campaign that was just armed", () => {
    /*
     * Not "whatever is due". The person is waiting for THIS email and has no
     * interest in another workspace's backlog being worked through first —
     * and a request that drains three tenants' campaigns is a request that
     * times out.
     */
    expect(SCHEDULE).toMatch(/onlyCampaignId:\s*campaignId/);
  });

  it("gives up sooner than the cron does", () => {
    // A button that holds a request open for the cron's forty-five seconds
    // reads as broken. The remainder is what the sweep is for.
    expect(SCHEDULE).toContain("INLINE_SEND_DEADLINE_MS");
    const at = SCHEDULE.indexOf("const INLINE_SEND_DEADLINE_MS");
    expect(at).toBeGreaterThan(-1);
    const value = /INLINE_SEND_DEADLINE_MS = ([\d_]+)/.exec(SCHEDULE)?.[1] ?? "";
    expect(Number(value.replace(/_/g, ""))).toBeLessThan(45_000);
  });

  it("only runs for an immediate send, never a future one", () => {
    // A campaign scheduled for Tuesday must not go out on Friday because
    // somebody pressed Save.
    const at = SCHEDULE.indexOf("if (when.immediate)");
    expect(at, "the inline pass is not gated on an immediate schedule").
      toBeGreaterThan(-1);
    expect(at).toBeLessThan(SCHEDULE.indexOf("runCampaignSweep("));
  });
});

describe("the inline pass cannot fail the request", () => {
  it("catches whatever the send throws", () => {
    /*
     * By this point the campaign IS armed and the row says so. If the pass
     * throws — provider down mid-batch — the honest answer is still 200: the
     * campaign is scheduled, the hourly sweep is the safety net it always was,
     * and every unreached row is still queued. A 500 here would tell somebody
     * their campaign did not send when it is queued and will.
     */
    const at = SCHEDULE.indexOf("if (when.immediate)");
    const body = SCHEDULE.slice(at, SCHEDULE.indexOf("return json({", at));
    expect(body).toContain("try {");
    expect(body).toContain("} catch");
    // And no early return inside the branch that would skip the 200.
    expect(body).not.toContain("return json(");
  });

  it("reports what it managed rather than claiming a send", () => {
    /*
     * `sent` carries the server's own counts. The screen says "3 sent just
     * now" or "the rest follow on the next sweep" from that, because after one
     * pass over a long list "Sent" would be the screen lying about the single
     * thing somebody is watching it for.
     */
    expect(SCHEDULE).toMatch(/sent,?\s*\n?\s*\}\);/);
    expect(SCHEDULE).toContain("run.summary");
  });
});
