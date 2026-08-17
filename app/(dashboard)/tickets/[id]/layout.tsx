/**
 * /tickets/[id] — splits the desktop's two right-hand panes off the list.
 *
 * WHY THIS LAYOUT EXISTS AT ALL
 *
 * The list pane used to be rendered by page.tsx alongside <Thread>, which
 * meant one `loading.tsx` had to cover all three panes — so clicking a row in
 * the list skeletoned the very list you clicked in. The list is already on
 * screen and its contents barely change, so that flash was pure flicker.
 *
 * Splitting the thread into a parallel-route SLOT gives it its own Suspense
 * boundary. `@thread/loading.tsx` is the fallback for the conversation and the
 * contact rail only; the list, which stays in the implicit `children` slot and
 * deliberately has NO loading.tsx of its own, is never replaced by a skeleton
 * during a client-side navigation. It holds its current rows until the new
 * ones commit.
 *
 * Measured on Next 16.2.10 (production build), list query ~600ms, thread
 * ~1500ms:
 *
 *   /inbox  → /tickets/1   old list held, then real list + thread skeleton
 *   /tickets/1 → /tickets/2   list held (selection updates), thread skeleton
 *
 * Neither transition renders (dashboard)/loading.tsx.
 *
 * Both slots match every /tickets/[id] URL, so no `default.tsx` is needed —
 * that file only exists for slots that can go unmatched on a hard load.
 *
 * No wrapper element: `.pbm-main` is the flex ROW, and these two are its
 * columns. A <div> here would collapse them into one.
 */
export default function TicketLayout({
  children,
  thread,
}: {
  children: React.ReactNode;
  thread: React.ReactNode;
}) {
  return (
    <>
      {children}
      {thread}
    </>
  );
}
