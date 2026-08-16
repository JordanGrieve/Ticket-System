"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";

/**
 * The star toggle, used on every list row and in the thread header.
 *
 * Optimistic: the icon flips immediately and reverts if the write fails,
 * because a star is the kind of control people press while their eye is
 * already moving to the next row. `router.refresh()` afterwards is what keeps
 * the Starred folder count in the nav honest — the count is a real COUNT(*) on
 * the server, not something this component can compute.
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
  const router = useRouter();
  const [on, setOn] = useState(starred);
  const [pending, startTransition] = useTransition();

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
    if (pending) return;
    const next = !on;
    setOn(next);
    const res = await fetch(`/api/tickets/${ticketId}/star`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: next }),
    });
    if (!res.ok) {
      setOn(!next);
      return;
    }
    startTransition(() => router.refresh());
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
  );
}
