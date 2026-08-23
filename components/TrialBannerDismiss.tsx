"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Lets the mildest trial notice be put away — until the number changes.
 *
 * `dismissKey` carries the days remaining, so dismissing "6 days left" hides
 * that and nothing else: tomorrow's "5 days left" is a different key and comes
 * back. A single permanent dismissal would mean somebody who waved the banner
 * away on day one never sees it again, which defeats the point of a countdown
 * that exists so the trial does not end as a surprise.
 *
 * ── WHY useSyncExternalStore AND NOT useEffect ──
 * localStorage is external mutable state, which is exactly what this hook is
 * for. Reading it in an effect and calling setState is both the thing the
 * React Compiler lint refuses and a real flash: the server renders the banner,
 * hydration removes it, and somebody who dismissed it yesterday watches it
 * blink away. `getServerSnapshot` returns "hidden" so the server renders
 * nothing and the client decides — a banner that appears a frame late is
 * invisible; one that appears and vanishes looks broken.
 *
 * localStorage rather than a cookie because this is a UI preference the server
 * has no use for, and a cookie would ride along on every request for the life
 * of the session to save a few lines here.
 */

/** No-op subscribe: nothing else in this tab mutates the key. */
function subscribe(onChange: () => void): () => void {
  // Another tab dismissing the same banner should hide it here too — cheap,
  // and it stops the two tabs disagreeing about a thing the user has decided.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export default function TrialBannerDismiss({
  dismissKey,
  children,
}: {
  dismissKey: string;
  children: React.ReactNode;
}) {
  const storageKey = `pbt:${dismissKey}`;

  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      // Private browsing, or storage disabled. Showing the banner is the safe
      // failure: the worst case is somebody dismisses it twice.
      return false;
    }
  }, [storageKey]);

  // Hidden during SSR so nothing is painted before the client has decided.
  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => true);

  if (hidden) return null;

  return (
    <div className="pbt-dismissable">
      {children}
      <button
        type="button"
        className="pbt-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey, "1");
            // setItem does not fire `storage` in the tab that wrote it, so
            // nudge our own subscribers.
            window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
          } catch {
            // Not being able to REMEMBER the dismissal is no reason to refuse
            // to perform it — but without storage the re-render has nothing to
            // read, so the banner would stay. Accepted: storage being off is
            // rare, and the alternative is local state that disagrees with the
            // stored value everywhere else.
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
