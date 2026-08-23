import { describe, it, expect } from "vitest";
import {
  workspaceHealth,
  GRACE_DAYS,
  MIN_QUIET_DAYS,
  type WorkspaceHealthInput,
} from "../lib/workspace-health";

/**
 * The test that matters is the real incident.
 *
 * Open Door Bakery: created 12 July 2026, contact form broken from day one,
 * zero enquiries ever, discovered 22 August when the client complained. The
 * admin screen showed "No enquiries yet" in muted grey for all six weeks.
 *
 * Everything else here exists to stop the fix becoming a nuisance. A detector
 * that flags a quiet bakery every fortnight gets ignored, and an ignored
 * detector leaves you exactly where you started with more noise.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-22T20:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function input(over: Partial<WorkspaceHealthInput> = {}): WorkspaceHealthInput {
  return {
    pending: false,
    createdAt: ago(60),
    totalCount: 10,
    firstTicketAt: ago(50),
    lastTicketAt: ago(2),
    now: NOW,
    ...over,
  };
}

describe("the Open Door Bakery case", () => {
  it("flags a workspace that has NEVER received anything after six weeks", () => {
    // The actual numbers: created 12 Jul, checked 22 Aug, zero tickets.
    const h = workspaceHealth(
      input({
        createdAt: new Date("2026-07-12T00:00:00Z"),
        totalCount: 0,
        firstTicketAt: null,
        lastTicketAt: null,
      }),
    );
    expect(h.state).toBe("never_received");
    expect(h.needsAttention).toBe(true);
    expect(h.daysSilent).toBe(41);
    // The detail must point at the actual cause, which was a stale key in the
    // client's own environment.
    expect(h.detail).toMatch(/key/i);
  });

  it("does NOT flag a workspace set up days ago with nothing yet", () => {
    // The state the bakery was wrongly shown as. It is a real state — it just
    // has to expire.
    const h = workspaceHealth(
      input({ createdAt: ago(3), totalCount: 0, firstTicketAt: null, lastTicketAt: null }),
    );
    expect(h.state).toBe("settling");
    expect(h.needsAttention).toBe(false);
  });

  it("flips from settling to never_received exactly at the grace boundary", () => {
    const quiet = (age: number) =>
      workspaceHealth(
        input({ createdAt: ago(age), totalCount: 0, firstTicketAt: null, lastTicketAt: null }),
      ).state;
    expect(quiet(GRACE_DAYS - 1)).toBe("settling");
    expect(quiet(GRACE_DAYS)).toBe("never_received");
  });
});

describe("not crying wolf", () => {
  it("leaves a low-volume workspace alone within its normal rhythm", () => {
    // 6 enquiries over 60 days — one about every 12 days. Eleven days of
    // silence is an ordinary Tuesday, not an outage.
    const h = workspaceHealth(
      input({ totalCount: 6, firstTicketAt: ago(71), lastTicketAt: ago(11) }),
    );
    expect(h.state).toBe("healthy");
    expect(h.needsAttention).toBe(false);
  });

  it("flags the same workspace once silence is several times its normal gap", () => {
    // Same rate, but 40 days of nothing.
    const h = workspaceHealth(
      input({ totalCount: 6, firstTicketAt: ago(100), lastTicketAt: ago(40) }),
    );
    expect(h.state).toBe("gone_quiet");
    expect(h.needsAttention).toBe(true);
    // States the evidence, not a verdict — "37 days, normally about 4" is
    // actionable in a way that "unhealthy" is not.
    expect(h.detail).toMatch(/40 days/);
    expect(h.detail).toMatch(/every 12 days/);
  });

  it("never flags a busy workspace after only a few days", () => {
    // Ten enquiries a day, silent for 4 days. 4 >= averageGap*3 is TRUE here,
    // so only the MIN_QUIET_DAYS floor prevents a false alarm — which is
    // exactly why that floor exists.
    const h = workspaceHealth(
      input({ totalCount: 300, firstTicketAt: ago(34), lastTicketAt: ago(4) }),
    );
    expect(h.daysSilent).toBeLessThan(MIN_QUIET_DAYS);
    expect(h.needsAttention).toBe(false);
  });

  it("does flag a busy workspace once it passes the floor", () => {
    const h = workspaceHealth(
      input({ totalCount: 300, firstTicketAt: ago(40), lastTicketAt: ago(10) }),
    );
    expect(h.state).toBe("gone_quiet");
  });
});

describe("thin history", () => {
  it("does not invent a rate from a single enquiry", () => {
    // One data point gives no gap to average. Falls back to a fixed window
    // rather than fabricating a baseline.
    const h = workspaceHealth(
      input({ totalCount: 1, firstTicketAt: ago(5), lastTicketAt: ago(5) }),
    );
    expect(h.state).toBe("healthy");
    expect(h.detail).not.toMatch(/average/);
  });

  it("flags a single old enquiry and nothing since", () => {
    const h = workspaceHealth(
      input({ totalCount: 1, firstTicketAt: ago(40), lastTicketAt: ago(40) }),
    );
    expect(h.state).toBe("gone_quiet");
    expect(h.needsAttention).toBe(true);
  });

  it("survives two enquiries at the same instant without dividing by zero", () => {
    const t = ago(30);
    const h = workspaceHealth(
      input({ totalCount: 2, firstTicketAt: t, lastTicketAt: t }),
    );
    expect(Number.isFinite(h.daysSilent)).toBe(true);
    expect(h.state).toBe("gone_quiet");
  });
});

describe("invited workspaces", () => {
  it("reports an unclaimed invite without demanding attention", () => {
    // Chasing an invite is a different job from noticing a broken integration.
    // Conflating them means the urgent signal arrives wrapped in the routine.
    const h = workspaceHealth(
      input({ pending: true, createdAt: ago(90), totalCount: 0, firstTicketAt: null, lastTicketAt: null }),
    );
    expect(h.state).toBe("invited");
    expect(h.needsAttention).toBe(false);
    expect(h.detail).toMatch(/never signed in/);
  });
});
