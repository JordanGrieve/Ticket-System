import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lists } from "@/db/schema";

/**
 * The one read the composer needs that no existing module exposes: the
 * workspace's audience lists, for the picker.
 *
 * TENANCY. `lists` carries workspace_id, so the filter is direct. Nothing else
 * is read here — the recipient COUNT deliberately does not come from this file.
 * It comes from GET /api/campaigns/:id/audience, which runs `selectAudience`,
 * the same function the write path runs. A count computed here would be a
 * second implementation of the suppression rule and would drift from the real
 * one, which is exactly the lie lib/newsletter.ts's header warns about.
 */

export type AudienceListOption = {
  id: number;
  name: string;
  description: string | null;
};

export async function workspaceLists(
  workspaceId: number,
): Promise<AudienceListOption[]> {
  return db
    .select({
      id: lists.id,
      name: lists.name,
      description: lists.description,
    })
    .from(lists)
    .where(eq(lists.workspaceId, workspaceId))
    .orderBy(asc(lists.name));
}
