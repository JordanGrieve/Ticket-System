import { redirect } from "next/navigation";
import MessageList from "@/components/mail/MessageList";
import { resolveViewer } from "@/lib/viewer";
import { TICKETS_PAGE_SIZE } from "@/lib/data";
import {
  listMailPage,
  mailCounts,
  mailFolderTotal,
  parseFolder,
  toMailRow,
  viewerAgentId,
} from "../../queries";

/**
 * The `children` slot of /tickets/[id]: the 336px list pane, nothing else.
 *
 * The list lives here rather than in layout.tsx because it needs `folder`,
 * `page` and `label` from searchParams, and layouts do not receive them — they
 * are not re-rendered on navigation, so the values would go stale (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md,
 * "Query params").
 *
 * TWO RULES THIS FILE MUST KEEP, or the list starts flashing again:
 *
 *  1. There is no `loading.tsx` in this folder. Adding one would make it the
 *     list's Suspense fallback, which is precisely the bug that was fixed.
 *
 *  2. The default export must NOT be `async` and must not `await` anything.
 *     The segment has to be able to emit a shell synchronously; the awaits
 *     happen inside <ListPane>, below, reached through a promise child. If
 *     this component awaits, the whole segment suspends with nothing to show,
 *     Next walks up to (dashboard)/loading.tsx, and every pane skeletons —
 *     measured, not assumed.
 */
export default function TicketListPane({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ folder?: string; page?: string; label?: string }>;
}) {
  // Unwrapped with .then() rather than awaited so ListPane takes a plain
  // number and this component stays synchronous. See rule 2 above.
  return <>{params.then((p) => <ListPane idParam={p.id} searchParams={searchParams} />)}</>;
}

async function ListPane({
  idParam,
  searchParams,
}: {
  idParam: string;
  searchParams: Promise<{ folder?: string; page?: string; label?: string }>;
}) {
  // A non-integer id is a 404, but that is the thread slot's call to make —
  // it is the half that actually loads the ticket. Here it just means no row
  // is highlighted.
  const ticketId = Number(idParam);
  const selectedId = Number.isInteger(ticketId) ? ticketId : undefined;

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

  const [counts, rows, agentId] = await Promise.all([
    mailCounts(workspaceId),
    listMailPage(workspaceId, folder, page, labelId),
    viewerAgentId(workspaceId),
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
    <MessageList
      rows={rows.map((r) => toMailRow(r, now))}
      folder={folder}
      page={Math.min(page, pageCount)}
      pageCount={pageCount}
      total={total}
      selectedId={selectedId}
      labelId={labelId}
      canPersonalise={agentId !== null}
      hideOnMobile
    />
  );
}
