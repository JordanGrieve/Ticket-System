import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The rules that make deleting a campaign safe.
 *
 * `deleteCampaign` opens a database connection, and CI has no DATABASE_URL, so
 * this reads the shipped source the way tests/tenancy-invariants.test.ts does.
 * That is not a second-best here: every rule worth guarding is a predicate in
 * a WHERE clause, and a predicate is exactly the thing a source read can see
 * and a mocked database cannot.
 *
 * What is being guarded, in order of how badly it ends:
 *
 *  1. No workspace predicate → one tenant deletes another's campaign by
 *     guessing a number.
 *  2. No status predicate → a campaign is deleted out from under the send
 *     loop mid-flight, or a `sent` one is destroyed. `sent` is the record of
 *     what a client's customers were told; there is no other copy.
 *  3. The two live in ONE statement. Checking status with a read and then
 *     deleting is a race: the sweep promotes drafts to `sending` on its own
 *     schedule, and it only has to land between the two statements once.
 */

const ROOT = join(__dirname, "..");
const source = readFileSync(join(ROOT, "lib/campaign-send.ts"), "utf8");

/** The body of deleteCampaign, from its signature to the closing brace. */
function deleteCampaignBody(): string {
  const at = source.indexOf("export async function deleteCampaign");
  expect(at, "deleteCampaign is gone or renamed — this whole file is now vacuous").toBeGreaterThan(
    -1,
  );
  const end = source.indexOf("\n}", at);
  expect(end, "could not find the end of deleteCampaign").toBeGreaterThan(at);
  return source.slice(at, end);
}

describe("deleting a campaign", () => {
  const body = deleteCampaignBody();

  it("deletes from campaigns, in one statement", () => {
    expect(body).toContain("db\n    .delete(campaigns)");
    expect(
      (body.match(/\.delete\(/g) ?? []).length,
      "more than one delete in here means something else is being destroyed too",
    ).toBe(1);
  });

  it("constrains the workspace", () => {
    expect(
      body,
      "without this, any tenant can delete any campaign by guessing its id",
    ).toContain("eq(campaigns.workspaceId, workspaceId)");
  });

  it("constrains the status to draft, in the statement itself", () => {
    expect(
      body,
      "a campaign that is sending, sent or failed must not be deletable",
    ).toContain('eq(campaigns.status, "draft")');

    // Both predicates in the same WHERE. A status read followed by a delete is
    // a race the sweep wins eventually.
    const whereAt = body.indexOf(".where(");
    const returningAt = body.indexOf(".returning(");
    const where = body.slice(whereAt, returningAt);
    expect(where).toContain("workspaceId");
    expect(where).toContain('"draft"');
  });

  it("tells a missing campaign apart from an undeletable one", () => {
    // 404 and 409 are different answers and the caller acts on them
    // differently — one is "gone", the other is "cancel the schedule first".
    expect(body).toContain("not_deletable");
    expect(body).toContain("getCampaign(workspaceId, campaignId)");
  });
});

describe("the route that exposes it", () => {
  const route = readFileSync(
    join(ROOT, "app/api/campaigns/[id]/route.ts"),
    "utf8",
  );

  it("requires a signed-in user and a selected workspace", () => {
    const at = route.indexOf("export async function DELETE");
    expect(at, "no DELETE handler").toBeGreaterThan(-1);
    const handler = route.slice(at);
    expect(handler).toContain("await auth()");
    expect(handler).toContain("Unauthorized");
    expect(handler).toContain("await activeWorkspace()");
  });

  it("answers 404 for an id it cannot see and 409 for one it will not delete", () => {
    const handler = route.slice(route.indexOf("export async function DELETE"));
    expect(handler).toContain("status: 404");
    expect(handler).toContain("status: 409");
  });
});
