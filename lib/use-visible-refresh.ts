import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetch the current route's server data every `intervalMs`, but only while
 * the tab is visible — a background tab polling the server is work nobody is
 * looking at.
 *
 * `enabled` lets a caller stand down without breaking the rules of hooks: the
 * inbox list skips its own timer while a thread is open, because the thread
 * already refreshes the whole route.
 */
export function useVisibleRefresh(intervalMs: number, enabled = true): void {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, enabled]);
}
