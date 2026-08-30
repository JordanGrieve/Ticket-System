import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { requeueFailedRecipients } from "@/lib/campaign-send";

/**
 * POST /api/campaigns/:id/requeue → put a wholly-failed campaign back in draft
 *
 * ── WHY THIS EXISTS ──
 *
 * A recipient whose send failed went to `failed` and nothing in the product
 * could move it back. docs/NEWSLETTER.md carries the warning in its own words:
 * "Open Door Bakery has one confirmed subscriber; in the sandbox that send is
 * rejected, the row is written `failed`, the campaign is marked `sent`, and
 * nothing in the product can re-queue it."
 *
 * That is the same shape of trap ./abort was written for — a state the product
 * can reach and cannot leave — except the cost here is not a stuck campaign,
 * it is a spent subscriber. With a list of one, a single mistimed send ends
 * the campaign until somebody re-subscribes.
 *
 * ── THE DANGEROUS VERSION OF THIS FEATURE IS NOT OFFERED ──
 *
 * "Retry the failed ones" can put a second copy in somebody's inbox. Claim-
 * before-send marks a row `sent` BEFORE the provider call, so a `failed` row
 * sitting beside delivered ones cannot be retried without a coin toss on
 * whether the first one arrived.
 *
 * So this refuses unless NOBODY was reached: no row was ever handed to the
 * provider and none is still queued. A second attempt then cannot be a second
 * copy, because there was never a first. The risk is removed by the
 * precondition rather than delegated to whoever is reading the dialog — see
 * lib/campaign-requeue.ts for the argument in full.
 *
 * ── WHERE THE CHECK LIVES ──
 *
 * In the UPDATE, as a NOT EXISTS. The condition is about rows the sweep could
 * be claiming right now, so evaluating it beforehand and trusting the answer
 * is exactly the race this codebase writes tenancy predicates to avoid. The
 * statement either matches at write time or changes nothing.
 *
 * ── TENANCY ──
 *
 * `workspace_id` is in the statement's own WHERE, so an id from another tenant
 * matches zero rows and returns 404 having written nothing.
 */

function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/campaigns/[id]/requeue">,
) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const campaignId = idFrom((await ctx.params).id);
  if (campaignId === null) {
    return json({ error: "Invalid campaign id" }, { status: 400 });
  }

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const result = await requeueFailedRecipients(workspace.id, campaignId);
  if (result === null) return json({ error: "Not found" }, { status: 404 });

  if ("error" in result) {
    /*
      One refusal covering three states, deliberately not distinguished: still
      sending, nothing failed, or somebody was reached. Saying which would
      require a second read whose answer could differ from the one the write
      just acted on — and the only one a person needs to act on is the last,
      which the composer already explains from counts it holds. The wording
      leads with it because it is the one that sounds like a bug otherwise.
    */
    return json(
      {
        error:
          "These recipients can’t be put back. Re-queueing is only possible when a campaign reached nobody at all — if any message got through, retrying could send somebody a duplicate. Build a new campaign for the people who missed out.",
      },
      { status: 409 },
    );
  }

  return json({ ok: true, requeued: result.requeued });
}
