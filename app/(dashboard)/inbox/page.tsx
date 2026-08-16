import { redirect } from "next/navigation";
import MessageList from "@/components/mail/MessageList";
import MobileTabs from "@/components/mail/MobileTabs";
import { resolveViewer } from "@/lib/viewer";
import { TICKETS_PAGE_SIZE } from "@/lib/data";
import { listMailPage, mailCounts, parseFolder, toMailRow } from "../queries";

/**
 * Desktop shows the list beside a "pick a thread" placeholder; the phone shows
 * only the list (the placeholder is hidden by mail.css). The thread route
 * renders the same list pane so the two-pane desktop layout survives
 * navigation.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; page?: string }>;
}) {
  const { folder: folderParam, page: pageParam } = await searchParams;
  const folder = parseFolder(folderParam);
  const page = Math.max(1, Number(pageParam) || 1);

  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");

  const [counts, rows] = await Promise.all([
    mailCounts(viewer.workspace.id),
    listMailPage(viewer.workspace.id, folder, page),
  ]);

  const total = counts[folder];
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
      />
      <section className="pbm-thread pbm-thread--empty" data-hide-mobile>
        <p className="pbm-placeholder-title">No thread open</p>
        <p className="pbm-placeholder-body">
          Pick a message on the left to read the conversation and reply.
        </p>
      </section>
      <MobileTabs />
    </>
  );
}
