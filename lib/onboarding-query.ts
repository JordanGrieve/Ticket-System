import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { onboardingProgress, type OnboardingProgress } from "./onboarding";
import { getWorkspaceEntitlement } from "./billing-query";
import { planById } from "./pricing";

/**
 * The database half of the setup checklist. lib/onboarding.ts holds the rules
 * and knows nothing about storage.
 *
 * ── ONE ROUND TRIP ──
 * Six separate counts would be six network hops on a page that renders on
 * every inbox load, over neon-http where each one is its own HTTP request.
 * They are asked as scalar subqueries in a single statement instead.
 *
 * ── EXISTS, NOT COUNT ──
 * Every question here is "is there at least one", and `count(*)` on a table
 * that could hold a hundred thousand tickets scans far more than it needs to.
 * EXISTS stops at the first row.
 *
 * Returns null when the workspace is missing, which callers should read as
 * "show nothing" rather than "show an empty checklist" — a checklist claiming
 * a real workspace has done nothing is worse than no checklist.
 */
export async function getOnboardingProgress(
  workspaceId: number,
): Promise<OnboardingProgress | null> {
  const [row] = await db
    .select({
      // Trimmed, so a postal address of "   " does not count as supplied.
      // The send path applies the same test; a checklist that disagreed with
      // it would tick this and then refuse the send.
      hasPostalAddress: sql<boolean>`coalesce(btrim(${workspaces.postalAddress}), '') <> ''`,
      hasFormTicket: sql<boolean>`EXISTS (
        SELECT 1 FROM tickets t
        WHERE t.workspace_id = ${workspaceId} AND t.source = 'contact_form'
      )`,
      hasAnyTicket: sql<boolean>`EXISTS (
        SELECT 1 FROM tickets t WHERE t.workspace_id = ${workspaceId}
      )`,
      autoReplyEnabled: sql<boolean>`EXISTS (
        SELECT 1 FROM auto_replies a
        WHERE a.workspace_id = ${workspaceId} AND a.enabled = true
      )`,
      // Confirmed subscribers only. Somebody who submitted a form and never
      // pressed the link is not stored at all, so this cannot be ticked by a
      // stranger typing an address into a public form.
      hasSubscriber: sql<boolean>`EXISTS (
        SELECT 1 FROM subscribers s
        WHERE s.workspace_id = ${workspaceId} AND s.status = 'subscribed'
      )`,
      // More than one agent row, INCLUDING pending invites: sending the invite
      // is the step, and holding the tick until the other person happens to
      // sign in would leave it looking undone for something already finished.
      hasTeammate: sql<boolean>`(
        SELECT count(*) FROM agents ag WHERE ag.workspace_id = ${workspaceId}
      ) > 1`,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!row) return null;

  // Starter is inbox-only, so its checklist must not include steps a Starter
  // customer cannot complete. A trial has the full product, so it counts as
  // having newsletters.
  const ent = await getWorkspaceEntitlement(workspaceId);
  const newslettersAvailable =
    !ent || ent.plan === "trial"
      ? true
      : (planById(ent.plan)?.limits.subscribers ?? 0) > 0;

  return onboardingProgress({
    hasFormTicket: Boolean(row.hasFormTicket),
    hasAnyTicket: Boolean(row.hasAnyTicket),
    autoReplyEnabled: Boolean(row.autoReplyEnabled),
    hasPostalAddress: Boolean(row.hasPostalAddress),
    hasSubscriber: Boolean(row.hasSubscriber),
    hasTeammate: Boolean(row.hasTeammate),
    newslettersAvailable,
  });
}
