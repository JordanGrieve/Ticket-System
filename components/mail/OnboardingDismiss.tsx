"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Lets somebody put the setup checklist away for good.
 *
 * ── THIS REVERSES A DECISION THAT WAS WRITTEN DOWN ──
 * OnboardingChecklist.tsx used to carry a heading saying "NO DISMISS BUTTON",
 * arguing that the list occupies dead space, covers nothing, and removes
 * itself once the required steps are done — so a dismiss control would only
 * let somebody hide the list of things standing between them and a working
 * product, and then wonder why the product does not work.
 *
 * That reasoning is not wrong, but it assumes the reader wants what the list
 * is offering. Somebody running a bakery inbox who has decided they are never
 * turning on an auto-reply is being shown an unfinishable list every time they
 * open an empty thread pane, with no way to say so. Making the decision FOR
 * them is the part that does not hold.
 *
 * The onboarding research reached the same place from the other direction:
 * forced action is a catalogued deceptive pattern, and a checklist that cannot
 * be dismissed is the textbook instance.
 *
 * ── PER BROWSER, NOT PER WORKSPACE ──
 * localStorage rather than a column. This is one person deciding they have
 * seen enough, not a fact about the business — hiding it for a colleague who
 * has never seen it would be a different and worse thing. It also needs no
 * migration for a preference whose worst failure is that it reappears.
 *
 * useSyncExternalStore rather than an effect: reading storage in an effect and
 * calling setState is what the React Compiler lint refuses, and it flashes —
 * the server paints the checklist and hydration removes it, so somebody who
 * dismissed it last week watches it blink away every single load. The server
 * snapshot returns "hidden" so nothing is painted until the client has
 * decided. Same pattern as TrialBannerDismiss.
 */

const STORAGE_KEY = "pb:onboarding-dismissed";

function subscribe(onChange: () => void): () => void {
  // Dismissing in one tab should settle it in the others too.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export default function OnboardingDismiss({
  children,
}: {
  children: React.ReactNode;
}) {
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private browsing, or storage switched off. Showing the checklist is
      // the safe failure — the worst case is somebody dismisses it twice.
      return false;
    }
  }, []);

  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => true);
  if (hidden) return null;

  return (
    <>
      {children}
      <button
        type="button"
        className="pbo-dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(STORAGE_KEY, "1");
            // setItem does not fire `storage` in the tab that wrote it.
            window.dispatchEvent(
              new StorageEvent("storage", { key: STORAGE_KEY }),
            );
          } catch {
            // Unable to REMEMBER the choice is not a reason to refuse to act
            // on it — but with storage unavailable the re-read finds nothing,
            // so the list stays. Accepted: storage being off is rare, and a
            // local state that disagrees with every other surface is worse.
          }
        }}
      >
        {/*
          "Don't show this again", not "Dismiss". Dismiss suggests it comes
          back, and this does not — saying so is the difference between a
          control somebody trusts and one they press twice to check.
        */}
        Don&rsquo;t show this again
      </button>
    </>
  );
}
