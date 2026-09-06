"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A settings notice somebody can put away, and remember putting away.
 *
 * ── WHAT BELONGS IN HERE, AND WHAT MUST NOT ──
 * This is for a notice that EXPLAINS something — a rule, a state, why a
 * control is absent. Those are worth saying once and are noise on the fifth
 * visit, so they get a cross.
 *
 * It is NOT for a warning that sits in front of a decision. "They'll be able
 * to read every message your customers send" is on the invite form because
 * somebody is about to hand a stranger the keys to a client's inbox, and a
 * warning you can permanently silence is one that is absent for the person who
 * silenced it a month ago and has since forgotten. The test is simple: if the
 * notice describes a CONSEQUENCE OF THE BUTTON BELOW IT, it does not get a
 * cross. See app/(dashboard)/settings/team/page.tsx, where one of the two
 * notices is wrapped in this and the other deliberately is not.
 *
 * ── PER VIEWER, IN localStorage ──
 * Same reasoning as components/TrialBannerDismiss.tsx: this is one person
 * deciding they have read something, not a fact about the workspace. A column
 * would make one member's dismissal hide it from their colleagues, who have
 * not read it.
 *
 * ── useSyncExternalStore, NOT useEffect ──
 * localStorage is external mutable state, which is what the hook is for.
 * Reading it in an effect is what the React Compiler lint refuses, and it
 * flashes: the server paints the notice and hydration rips it away in front of
 * somebody who dismissed it last week. `getServerSnapshot` returns "hidden" so
 * the server paints nothing and the client decides — a notice that appears a
 * frame late is invisible; one that appears and vanishes looks broken.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export default function DismissibleNotice({
  id,
  className = "stg-notice",
  children,
}: {
  /**
   * Stable across renders and unique to the notice. Changing it un-dismisses,
   * which is the right behaviour when the WORDING changes: somebody who put
   * away the old sentence has not read the new one.
   */
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const storageKey = `pbn:${id}`;

  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      // Private browsing, or storage disabled. Showing it is the safe failure:
      // the worst case is somebody dismisses the same notice twice.
      return false;
    }
  }, [storageKey]);

  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => true);

  if (hidden) return null;

  return (
    <div className={`${className} stg-notice--dismissible`} role="note">
      <div className="stg-notice-body">{children}</div>
      <button
        type="button"
        className="stg-notice-x"
        // Names the thing being dismissed. "Close" alone, heard out of
        // context by a screen reader, says nothing about what is going away.
        aria-label="Dismiss this notice"
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey, "1");
            // setItem does not fire `storage` in the tab that wrote it.
            window.dispatchEvent(
              new StorageEvent("storage", { key: storageKey }),
            );
          } catch {
            // Unable to REMEMBER the dismissal is no reason to refuse it — but
            // with storage off the re-read finds nothing and it stays put.
          }
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M5 5l14 14M19 5L5 19" />
        </svg>
      </button>
    </div>
  );
}
