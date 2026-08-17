import { auth } from "@clerk/nextjs/server";
import { json } from "@/lib/http";
import { activeWorkspace } from "@/lib/viewer";
import { SEARCH_GROUP_LIMIT, searchWorkspace } from "@/lib/search";

/**
 * GET /api/search?q=…&limit=… → grouped matches inside the ACTIVE workspace.
 *
 * The workspace is never taken from the request. It comes from
 * `activeWorkspace()`, which resolves the signed-in tenant — or, for a Postbox
 * operator, the client they entered through the audited impersonation path. So
 * there is no id in the query string a caller could swap for someone else's,
 * and `searchWorkspace` filters every one of its four statements on it (see
 * the tenancy note in lib/search.ts).
 *
 * Uncached by default, which is what we want: results are per tenant and per
 * agent, and a shared cache entry here would be a cross-tenant leak of exactly
 * the kind the rest of this file is written to avoid.
 */

/** Never let a caller ask for an unbounded page of another tenant-sized scan. */
const LIMIT_MAX = 25;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await activeWorkspace();
  if (!workspace) {
    return json({ error: "Select a client workspace first." }, { status: 400 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";

  const asked = Number(url.searchParams.get("limit"));
  const limit =
    Number.isInteger(asked) && asked > 0
      ? Math.min(asked, LIMIT_MAX)
      : SEARCH_GROUP_LIMIT;

  const results = await searchWorkspace(workspace.id, q, limit);
  return json({ results });
}
