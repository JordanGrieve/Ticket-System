import { describe, it, expect } from "vitest";
import {
  buildHealthReport,
  CAMPAIGN_STALL_DAYS,
  type WorkspaceHealthRow,
  type StalledCampaignRow,
} from "../lib/health-report";

/**
 * A daily alerting job has exactly two ways to fail, and only one of them is
 * obvious.
 *
 * It can miss a real problem. It can also report the same problem every day
 * until the operator mutes the channel — at which point it misses every real
 * problem afterwards, silently, and nobody notices because the job is "working".
 * The fingerprint tests below are about the second failure.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-23T09:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function workspace(over: Partial<WorkspaceHealthRow> = {}): WorkspaceHealthRow {
  return {
    id: 12,
    name: "Open Door Bakery",
    pending: false,
    createdAt: ago(60),
    totalCount: 10,
    firstTicketAt: ago(50),
    lastTicketAt: ago(1),
    ...over,
  };
}

function campaign(over: Partial<StalledCampaignRow> = {}): StalledCampaignRow {
  return {
    campaignId: 1,
    campaignName: "August news",
    workspaceId: 12,
    workspaceName: "Open Door Bakery",
    queued: 40,
    sendingSinceDays: 3,
    ...over,
  };
}

const empty = { workspaces: [], sendingCampaigns: [], now: NOW };

describe("what gets reported", () => {
  it("says nothing when everything is fine", () => {
    const r = buildHealthReport({ ...empty, workspaces: [workspace()] });
    expect(r.alerts).toEqual([]);
    // The run is still legible without Sentry — "checked 1, found 0" is a
    // different statement from "the job did not run".
    expect(r.checked.workspaces).toBe(1);
  });

  it("reports the Open Door Bakery case", () => {
    const r = buildHealthReport({
      ...empty,
      workspaces: [
        workspace({
          createdAt: new Date("2026-07-12T00:00:00Z"),
          totalCount: 0,
          firstTicketAt: null,
          lastTicketAt: null,
        }),
      ],
    });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].kind).toBe("workspace_silent");
    // Names the client. An alert that says "a workspace is quiet" makes the
    // operator go and find out which one.
    expect(r.alerts[0].title).toContain("Open Door Bakery");
    expect(r.alerts[0].level).toBe("warning");
  });

  it("treats a wedged campaign as an error, not a warning", () => {
    // A campaign stuck in `sending` cannot be edited, cancelled or discarded
    // from inside the product. That is a dead end for the client, and worse
    // than a workspace that has merely gone quiet.
    const r = buildHealthReport({ ...empty, sendingCampaigns: [campaign()] });
    expect(r.alerts[0].kind).toBe("campaign_stalled");
    expect(r.alerts[0].level).toBe("error");
  });

  it("does not report a campaign that is simply still draining", () => {
    const r = buildHealthReport({
      ...empty,
      sendingCampaigns: [campaign({ queued: 0, sendingSinceDays: 9 })],
    });
    expect(r.alerts).toEqual([]);
  });

  it("gives a campaign time before calling it stuck", () => {
    // The sweep is best-effort and GitHub delays it; a big audience takes days
    // to drain legitimately.
    const fresh = buildHealthReport({
      ...empty,
      sendingCampaigns: [campaign({ sendingSinceDays: CAMPAIGN_STALL_DAYS - 1 })],
    });
    expect(fresh.alerts).toEqual([]);

    const stale = buildHealthReport({
      ...empty,
      sendingCampaigns: [campaign({ sendingSinceDays: CAMPAIGN_STALL_DAYS })],
    });
    expect(stale.alerts).toHaveLength(1);
  });

  it("never reports an unclaimed invite as a broken integration", () => {
    const r = buildHealthReport({
      ...empty,
      workspaces: [
        workspace({ pending: true, totalCount: 0, firstTicketAt: null, lastTicketAt: null }),
      ],
    });
    expect(r.alerts).toEqual([]);
  });
});

describe("fingerprints — the difference between an alert and noise", () => {
  const silent = (days: number) =>
    buildHealthReport({
      ...empty,
      workspaces: [
        workspace({
          createdAt: ago(days),
          totalCount: 0,
          firstTicketAt: null,
          lastTicketAt: null,
        }),
      ],
    }).alerts[0];

  it("is STABLE as the problem ages", () => {
    // The whole point. Thirty days of silence must be ONE Sentry issue whose
    // count rises, not thirty issues. Including the day count would defeat the
    // grouping the fingerprint exists for.
    expect(silent(20).fingerprint).toBe(silent(50).fingerprint);
    // …while the human-readable detail still moves.
    expect(silent(20).detail).not.toBe(silent(50).detail);
  });

  it("separates different workspaces", () => {
    const r = buildHealthReport({
      ...empty,
      workspaces: [
        workspace({ id: 12, name: "A", totalCount: 0, firstTicketAt: null, lastTicketAt: null }),
        workspace({ id: 23, name: "B", totalCount: 0, firstTicketAt: null, lastTicketAt: null }),
      ],
    });
    expect(r.alerts).toHaveLength(2);
    expect(r.alerts[0].fingerprint).not.toBe(r.alerts[1].fingerprint);
  });

  it("separates different campaigns in the same workspace", () => {
    const r = buildHealthReport({
      ...empty,
      sendingCampaigns: [campaign({ campaignId: 1 }), campaign({ campaignId: 2 })],
    });
    expect(r.alerts[0].fingerprint).not.toBe(r.alerts[1].fingerprint);
  });

  it("separates a workspace that never received from one that went quiet", () => {
    // Different problems with different fixes, so different issues.
    const never = silent(60);
    const quiet = buildHealthReport({
      ...empty,
      workspaces: [workspace({ totalCount: 6, firstTicketAt: ago(100), lastTicketAt: ago(40) })],
    }).alerts[0];
    expect(never.fingerprint).not.toBe(quiet.fingerprint);
  });
});

describe("no customer content leaves the building", () => {
  it("carries ids, names and counts — never a ticket or an address", () => {
    const r = buildHealthReport({
      ...empty,
      workspaces: [
        workspace({ totalCount: 0, firstTicketAt: null, lastTicketAt: null, createdAt: ago(60) }),
      ],
      sendingCampaigns: [campaign()],
    });
    const blob = JSON.stringify(r);
    // The SDK's sendDefaultPii=false protects captured CONTEXT, not strings we
    // chose to put in a title. This is the source-level guard.
    expect(blob).not.toMatch(/@/); // no email addresses anywhere
    expect(blob).not.toMatch(/Avonbank|subject|body/i);
  });
});
