"use client";

import { useRef, useState } from "react";
import { Icon } from "./icons";
import { claimSwipe, swipeOffset, shouldStayOpen, REVEAL_PX } from "@/lib/swipe";

type FormAction = (formData: FormData) => void;

/**
 * Swipe an inbox card left to reveal Archive and Delete.
 *
 * ── WHAT IT DOES ──
 * Drag the card left and it follows the finger; let go past halfway and it
 * stays open with two buttons beside it. Tap the card while open and it
 * closes instead of navigating, so a stray tap after a swipe does not open a
 * thread you were about to delete. The decisions — whose gesture this is,
 * where the card sits, whether it stays open — live in lib/swipe.ts, where
 * they are tested.
 *
 * ── ONLY ON A PHONE, AND ONLY IN OPEN ──
 * The gesture is refused above 768px (checked at pointer-down, so a window
 * resized mid-drag cannot strand a half-open card), and MessageList only
 * hands actions over on the Open folder: archiving from Archived or deleting
 * from Trash is the wrong verb, and both actions redirect to Open afterwards
 * — which is where the card came from.
 *
 * ── THE CARD KEEPS SCROLLING THE LIST ──
 * `touch-action: pan-y` on the front, not `none`: the browser keeps vertical
 * scrolling and gives up horizontal, so the list scrolls exactly as before and
 * only a clearly sideways drag reaches here. claimSwipe then decides once per
 * gesture, biased toward scrolling, because a diagonal that hijacks a scroll
 * to half-open a card is worse than a swipe that has to be deliberate.
 *
 * ── THE BUTTONS ARE REAL FORMS ──
 * The same server actions the thread header posts, with the same redirect and
 * the same 30-day trash. No confirmation on Delete, for the reason Thread.tsx
 * gives: the undo IS the safety. While closed they are aria-hidden and out of
 * the tab order — a keyboard user has the same actions on the thread itself,
 * and a hidden button that can still be tabbed to is a control that speaks
 * without being seen.
 */
export default function SwipeRow({
  ticketId,
  actions,
  children,
}: {
  ticketId: number;
  actions: { archive: FormAction; trash: FormAction };
  children: React.ReactNode;
}) {
  const [x, setX] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; claimed: boolean } | null>(null);
  // True once the card has moved during this press, so the click that follows
  // a drag is swallowed rather than opening the thread.
  const moved = useRef(false);

  function settle(offset: number) {
    const stay = shouldStayOpen(offset);
    setOpen(stay);
    setX(stay ? -REVEAL_PX : 0);
    setDragging(false);
    gesture.current = null;
  }

  return (
    <div className="pbm-swipe" data-open={open || undefined} data-dragging={dragging || undefined}>
      <div className="pbm-swipe-actions" aria-hidden={!open}>
        <form action={actions.archive}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <button
            type="submit"
            className="pbm-swipe-btn pbm-swipe-btn--archive"
            tabIndex={open ? 0 : -1}
            aria-label="Archive this conversation"
          >
            <Icon name="archive" size={20} strokeWidth={1.9} />
            <span>Archive</span>
          </button>
        </form>
        <form action={actions.trash}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <button
            type="submit"
            className="pbm-swipe-btn pbm-swipe-btn--delete"
            tabIndex={open ? 0 : -1}
            aria-label="Delete this conversation — recoverable for 30 days"
          >
            <Icon name="trash" size={20} strokeWidth={1.9} />
            <span>Delete</span>
          </button>
        </form>
      </div>

      <div
        className="pbm-swipe-front"
        style={x ? { transform: `translateX(${x}px)` } : undefined}
        onPointerDown={(e) => {
          if (!window.matchMedia("(max-width: 768px)").matches) return;
          if (e.pointerType === "mouse" && e.button !== 0) return;
          gesture.current = { x: e.clientX, y: e.clientY, claimed: false };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.claimed) {
            const claim = claimSwipe(dx, dy);
            if (claim === "undecided") return;
            if (claim === "vertical") {
              gesture.current = null;
              return;
            }
            g.claimed = true;
            setDragging(true);
            // A drag that leaves the card — the point of the gesture — keeps
            // reporting here rather than to whatever is underneath.
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          moved.current = true;
          setX(swipeOffset(dx, open));
        }}
        onPointerUp={() => {
          if (!gesture.current?.claimed) {
            gesture.current = null;
            return;
          }
          settle(x);
        }}
        onPointerCancel={() => {
          // Taken away by the system: put it back where it was, never open.
          if (!gesture.current) return;
          setX(open ? -REVEAL_PX : 0);
          setDragging(false);
          gesture.current = null;
        }}
        onClickCapture={(e) => {
          if (moved.current) {
            moved.current = false;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (open) {
            e.preventDefault();
            e.stopPropagation();
            settle(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
