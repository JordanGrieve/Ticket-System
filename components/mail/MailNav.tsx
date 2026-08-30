import { activeWorkspace } from "@/lib/viewer";
import { listLabelsWithCounts } from "@/lib/labels";
import { getWorkspaceEntitlement } from "@/lib/billing-query";
import { planCard } from "@/lib/trial";
import { viewerAgentId } from "@/app/(dashboard)/queries";
import MailNavShell from "./MailNavShell";
import type { MailCountsDTO } from "./types";

/**
 * Server half of the navigation column.
 *
 * The nav needs three things the dashboard layout does not pass it: the
 * workspace's labels, their ticket counts, and whether the viewer has an agent
 * row here (which decides if Unread and Starred mean anything). Rather than
 * widen the layout's call — that file is owned by another workstream — this
 * component reads them itself. `activeWorkspace()` and `viewerAgentId()` are
 * both request-cached, so this costs one extra query for the labels and
 * nothing else.
 *
 * Props are unchanged from before, so the layout keeps compiling untouched.
 */
export default async function MailNav({
  workspaceName,
  userLabel,
  counts,
  isAdmin = false,
}: {
  workspaceName: string;
  userLabel: string;
  counts: MailCountsDTO;
  isAdmin?: boolean;
}) {
  const workspace = await activeWorkspace();
  const [labels, agentId, ent] = workspace
    ? await Promise.all([
        listLabelsWithCounts(workspace.id),
        viewerAgentId(workspace.id),
        getWorkspaceEntitlement(workspace.id),
      ])
    : [[], null, null];

  /*
    Null entitlement means no workspace, or a workspace row that has gone
    missing — the same fail-open case getWorkspaceEntitlement documents. The
    card is left out rather than guessed at: it is a statement about what
    somebody is paying, and inventing one is worse than showing none.
  */
  const billing = ent ? planCard(ent) : null;

  return (
    <MailNavShell
      workspaceName={workspaceName}
      userLabel={userLabel}
      counts={counts}
      labels={labels}
      canPersonalise={agentId !== null}
      billing={billing}
      isAdmin={isAdmin}
    />
  );
}
