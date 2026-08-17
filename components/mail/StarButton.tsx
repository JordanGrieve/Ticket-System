"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { publishStar } from "./live";

/**
 * The star toggle, used on every list row and in the thread header.
 *
 * Optimistic in both directions now. The icon flips immediately and reverts if
 * the write fails; the nav's Starred count moves via `publishStar` (see
 * live.ts) instead of the `router.refresh()` this used to fire. That refresh
 * re-rendered every pane on the server to change one number, which is a lot of
 * work to make a count agree with an icon the user is already looking away
 * from.
 *
 * What that trades away, deliberately: standing in the Starred folder and
 * unstarring a ticket no longer makes its row vanish under the cursor. The row
 * stays until the list's own 45s refresh or the next navigation. That reads
 * better than it sounds — the row you just acted on staying put is how you undo
 * a misclick — and it is the same behaviour as an unread ticket you have just
 * opened.
 *
 * Rendered disabled with an explanation when the viewer has no agent row in
 * this workspace (a super-admin acting inside a client): stars belong to a
 * person, and there is no person to hang this one on.
 */
export default function StarButton({
  ticketId,
  starred,
  canStar,
  size = 17,
  className = "pbm-icon-btn",
}: {
  ticketId: number;
  starred: boolean;
  canStar: boolean;
  size?: number;
  className?: string;
}) {
  const [on, setOn] = useState(starred);
  const [busy, setBusy] = useState(false);
  /**
   * Screen-reader-only narration. `aria-pressed` alone only speaks when the
   * button has focus, and on the list the star is very often clicked with a
   * pointer while focus is elsewhere — so the state changed silently. A failed
   * write was worse: the icon flipped back with nothing said at all.
   */
  const [announcement, setAnnouncement] = useState("");

  // The server is the source of truth after a refresh; adopt its answer when
  // the prop changes underneath us (another tab, or a folder change).
  const [lastProp, setLastProp] = useState(starred);
  if (lastProp !== starred) {
    setLastProp(starred);
    setOn(starred);
  }

  async function toggle(e: React.MouseEvent) {
    // The list row is a link; the star sits on top of it.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    const next = !on;
    setOn(next);
    setBusy(true);

    let ok = false;
    try {
      const res = await fetch(`/api/tickets/${ticketId}/star`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: next }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    setBusy(false);

    if (!ok) {
      setOn(!next);
      setAnnouncement("Couldn't change that star. Nothing was saved.");
      return;
    }

    setAnnouncement(next ? "Starred." : "Star removed.");
    // Only after the server has agreed — the nav count must never count a
    // star that was refused.
    publishStar({ ticketId, starred: next });
  }

  if (!canStar) {
    return (
      <button
        type="button"
        className={className}
        data-star="off"
        disabled
        aria-label="Star this thread (not available to admins)"
        title="Stars are personal to an agent in this workspace. You're viewing as an admin, so there's no inbox of your own to star into."
      >
        <Icon name="star" size={size} strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        data-star={on ? "on" : "off"}
        aria-pressed={on}
        aria-label={on ? "Remove star" : "Star this thread"}
        title={on ? "Remove star" : "Star this thread"}
        onClick={(e) => void toggle(e)}
      >
        <Icon name="star" size={size} strokeWidth={1.8} filled={on} />
      </button>
      {/* Rendered always, even while empty: a live region that is inserted at
          the same moment its text appears is frequently not announced. */}
      <span className="pbm-sr" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
