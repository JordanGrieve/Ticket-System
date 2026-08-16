import { activeWorkspace } from "@/lib/viewer";
import { listLabelsWithCounts } from "@/lib/labels";
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
  const [labels, agentId] = workspace
    ? await Promise.all([
        listLabelsWithCounts(workspace.id),
        viewerAgentId(workspace.id),
      ])
    : [[], null];

  return (
    <MailNavShell
      workspaceName={workspaceName}
      userLabel={userLabel}
      counts={counts}
      labels={labels}
      canPersonalise={agentId !== null}
      isAdmin={isAdmin}
    />
  );
}
