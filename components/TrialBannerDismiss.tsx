"use client";

import { useCallback, useSyncExternalStore } from "react";
import TrialBannerMeasure from "./TrialBannerMeasure";

/**
 * The dismissible wrapper for the mildest trial notice.
 *
 * ── WHY IT OWNS THE WHOLE SLOT, NOT JUST A BUTTON ──
 * `.pbt-slot ~ .pb-shell` is what pays for the banner's height. If this
 * component only rendered a close button and hid the banner inside the slot,
 * the slot would still be in the DOM, the shell would still be padded, and
 * dismissing would leave a blank 46px strip above the inbox. Returning null
 * for the entire slot is what makes the space come back.
 *
 * `dismissKey` carries the days remaining, so dismissing "6 days left" hides
 * that and nothing else: tomorrow's "5 days left" is a different key and comes
 * back. A single permanent dismissal would let somebody wave the banner away
 * on day one and never see it again, which defeats a countdown whose whole
 * purpose is that the trial does not end as a surprise.
 *
 * ── useSyncExternalStore, NOT useEffect ──
 * localStorage is external mutable state, which is what this hook is for.
 * Reading it in an effect and calling setState is both what the React Compiler
 * lint refuses and a real flash: the server renders the banner, hydration
 * removes it, and somebody who dismissed it yesterday watches it blink away.
 * `getServerSnapshot` returns "hidden" so the server paints nothing and the
 * client decides — a banner that appears a frame late is invisible; one that
 * appears and vanishes looks broken.
 */

function subscribe(onChange: () => void): () => void {
  // Another tab dismissing the same banner should hide it here too — cheap,
  // and it stops two tabs disagreeing about something the user has decided.
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

  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => true);

  if (hidden) return null;

  return (
    <div className="pbt-slot" data-tone="info">
      <div className="pbt-banner" role="status">
        {children}
      </div>
      <button
        type="button"
        className="pbt-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey, "1");
            // setItem does not fire `storage` in the tab that wrote it, so
            // nudge our own subscriber.
            window.dispatchEvent(
              new StorageEvent("storage", { key: storageKey }),
            );
          } catch {
            // Not being able to REMEMBER the dismissal is no reason to refuse
            // to perform it — but with storage unavailable the re-read has
            // nothing to find, so the banner stays. Accepted: storage being
            // off is rare, and local state that disagrees with the stored
            // value everywhere else is worse.
          }
        }}
      >
        ×
      </button>
      <TrialBannerMeasure />
    </div>
  );
}
