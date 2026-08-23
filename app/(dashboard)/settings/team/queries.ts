import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { isPlaceholderClerkId } from "@/lib/workspace";
import type { TeamMember } from "@/lib/team";

/**
 * Team reads. Deliberately NOT in actions.ts.
 *
 * ── WHY THIS FILE EXISTS ──
 * Every export from a `"use server"` module becomes a callable POST endpoint
 * with a generated id. `listTeam(workspaceId)` living in actions.ts was
 * therefore a public endpoint that took a workspace id as its argument — which
 * is a read of any tenant's team by anybody who could invoke it. It was written
 * that way for a few minutes and is recorded here so it is not written that way
 * again.
 *
 * The rule: a "use server" file exports ACTIONS ONLY, and every one of them
 * re-derives the workspace from the session rather than accepting it. Reads
 * live here, behind `server-only`, where they are reachable from a Server
 * Component and from nothing else.
 */
export async function listTeam(workspaceId: number): Promise<TeamMember[]> {
  const rows = await db
    .select({
      id: agents.id,
      email: agents.email,
      clerkUserId: agents.clerkUserId,
      role: agents.role,
    })
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    pending: isPlaceholderClerkId(r.clerkUserId),
    role: r.role,
  }));
}
