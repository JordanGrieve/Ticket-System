import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A campaign can be ARMED without belonging to a list.
 *
 * ── THE BUG THIS PINS ──
 * `scheduleCampaign` carried `list_id IS NOT NULL` in its UPDATE, from when a
 * campaign targeted a list somebody chose. Lists were retired — a campaign
 * goes to everyone confirmed in the workspace now, which is what
 * `workspaceAudience` selects — so every campaign created since has list_id
 * NULL and that clause matched nothing.
 *
 * Nothing could be scheduled. Not on a trial, not on a paid plan, not for the
 * pilot client. And the refusal named the wrong cause: the UPDATE matching
 * zero rows falls through to a diagnostic read whose only other answer is
 * "no queued recipients", so the client was sent to queue an audience they
 * had already queued.
 *
 * It survived because every other part of the product agreed the campaign was
 * ready: diagnoseCampaign reported no blockers, the recipients endpoint said
 * one was queued, and the queue endpoint had just returned inserted: 1. Found
 * on 11 Sep 2026 by running the whole journey on a brand-new account.
 *
 * ── WHY A SOURCE READ ──
 * Arming is one UPDATE whose WHERE is the entire safety argument, and CI has
 * no DATABASE_URL. The same instrument as tests/tenancy-invariants and
 * tests/campaign-delete: what is being guarded is a predicate, which is
 * exactly what a source read can see.
 */

const source = readFileSync(join(__dirname, "..", "lib/campaign-send.ts"), "utf8");

function scheduleBody(): string {
  const at = source.indexOf("export async function scheduleCampaign");
  expect(at, "scheduleCampaign is gone or renamed").toBeGreaterThan(-1);
  const end = source.indexOf("\n}", at);
  return source.slice(at, end);
}

describe("arming a campaign", () => {
  const body = scheduleBody();

  it("does NOT require a list", () => {
    expect(
      body,
      "lists are retired; requiring one here means nothing can ever be armed",
    ).not.toContain("listId} IS NOT NULL");
    expect(body).not.toContain("list_id IS NOT NULL");
  });

  it("still requires a queued recipient", () => {
    // The guard that must stay. Without it an empty campaign is promoted,
    // drains instantly, and is marked sent to an audience of nobody — past
    // isEditableStatus and therefore unfixable.
    expect(body).toContain("cr.status = 'queued'");
    expect(body).toContain("EXISTS");
  });

  it("still latches on the editable statuses", () => {
    // A campaign the sweep promoted to `sending` must not be re-armed by a
    // stale browser tab.
    expect(body).toContain(`inArray(campaigns.status, ["draft", "scheduled"])`);
  });

  it("still scopes to the workspace", () => {
    expect(body).toContain("eq(campaigns.workspaceId, workspaceId)");
  });
});

describe("the audience a campaign is actually sent to", () => {
  it("comes from the workspace, not from a list", () => {
    // The other half of the retirement. If this ever goes back to reading a
    // list, the clause removed above has to come back with it.
    expect(source).toContain("workspaceAudience");
    const at = source.indexOf("async function workspaceAudience");
    expect(at, "workspaceAudience is gone — has the list model returned?").toBeGreaterThan(-1);
  });
});
