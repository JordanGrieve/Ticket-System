import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";

/**
 * How many enquiries have arrived through each form.
 *
 * ── ONE ROUND TRIP, NOT ONE PER FORM ──
 * A count per form issued in a loop would be one neon-http request each, on a
 * page that renders on every visit. This groups in the database and comes back
 * as one result — the same reasoning as mailCounts in the dashboard.
 *
 * Deleted tickets are excluded. A form's count is a claim about what it has
 * brought in, and something in the trash is on its way out; including them
 * would make a count that goes down when somebody tidies up look like the form
 * had stopped working.
 */
export async function countTicketsPerForm(workspaceId: number): Promise<{
  /** form id → count. Forms with nothing yet are simply absent. */
  byForm: Map<number, number>;
  /** Contact-form tickets that came in on the workspace key. */
  unattributed: number;
}> {
  const rows = await db
    .select({
      formId: tickets.formId,
      n: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        eq(tickets.source, "contact_form"),
        isNull(tickets.deletedAt),
      ),
    )
    .groupBy(tickets.formId);

  const byForm = new Map<number, number>();
  let unattributed = 0;
  for (const row of rows) {
    // A null form id is a submission on the workspace key — every installation
    // that predates named forms, which is all of them today.
    if (row.formId === null) unattributed += row.n;
    else byForm.set(row.formId, row.n);
  }

  return { byForm, unattributed };
}
