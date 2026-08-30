import { redirect } from "next/navigation";
import MessageList from "@/components/mail/MessageList";
import MobileTabs from "@/components/mail/MobileTabs";
import OnboardingChecklist from "@/components/mail/OnboardingChecklist";
import OnboardingDismiss from "@/components/mail/OnboardingDismiss";
import { getOnboardingProgress } from "@/lib/onboarding-query";
import { resolveViewer } from "@/lib/viewer";
import { TICKETS_PAGE_SIZE } from "@/lib/data";
import {
  listMailPage,
  mailCounts,
  mailFolderTotal,
  parseFolder,
  toMailRow,
  viewerAgentId,
} from "../queries";

/**
 * Desktop shows the list beside a "pick a thread" placeholder; the phone shows
 * only the list (the placeholder is hidden by mail.css). The thread route
 * renders the same list pane so the two-pane desktop layout survives
 * navigation.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; page?: string; label?: string }>;
}) {
  const {
    folder: folderParam,
    page: pageParam,
    label: labelParam,
  } = await searchParams;
  const folder = parseFolder(folderParam);
  const page = Math.max(1, Number(pageParam) || 1);
  const labelNum = Number(labelParam);
  const labelId = Number.isInteger(labelNum) && labelNum > 0 ? labelNum : undefined;

  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspaceId = viewer.workspace.id;

  const [counts, rows, agentId, onboarding] = await Promise.all([
    mailCounts(workspaceId),
    listMailPage(workspaceId, folder, page, labelId),
    viewerAgentId(workspaceId),
    // In the Promise.all rather than awaited after it: this renders on every
    // inbox load, and neon-http gives each statement its own HTTP request, so
    // sequencing it would add a whole round trip to the page for nothing.
    getOnboardingProgress(workspaceId),
  ]);

  // A per-label view isn't one of the folder counts, so it needs its own
  // COUNT(*) — otherwise the pager would page against the wrong total.
  const total =
    labelId === undefined
      ? counts[folder]
      : await mailFolderTotal(workspaceId, folder, labelId);
  const pageCount = Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE));
  const now = new Date();

  return (
    <>
      <MessageList
        rows={rows.map((r) => toMailRow(r, now))}
        folder={folder}
        page={Math.min(page, pageCount)}
        pageCount={pageCount}
        total={total}
        labelId={labelId}
        canPersonalise={agentId !== null}
      />
      {/*
        The empty thread pane is the only screen space genuinely doing nothing:
        on a new workspace it invites you to pick from a list with nothing in
        it. While setup is outstanding it carries the checklist instead, and
        reverts to the placeholder once the required steps are done.
      */}
      <section className="pbm-thread pbm-thread--empty" data-hide-mobile>
        {/* OnboardingDismiss owns the whole block rather than just a button,
            so dismissing leaves no empty container behind. */}
        {onboarding && !onboarding.complete ? (
          <OnboardingDismiss>
            <OnboardingChecklist progress={onboarding} />
          </OnboardingDismiss>
        ) : (
          <>
            <p className="pbm-placeholder-title">No thread open</p>
            <p className="pbm-placeholder-body">
              Pick a message on the left to read the conversation and reply.
            </p>
          </>
        )}
      </section>
      <MobileTabs canPersonalise={agentId !== null} />
    </>
  );
}
