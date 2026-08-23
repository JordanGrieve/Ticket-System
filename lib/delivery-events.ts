import type { DeliveryStatus } from "@/db/schema";

/**
 * Resend delivery events → our DeliveryStatus. Pure.
 *
 * ── STATUS ONLY EVER MOVES FORWARD ──
 * Webhooks arrive out of order and are retried. `email.sent` can land after
 * `email.delivered` for the same message, and without an ordering rule the
 * later-arriving-but-earlier event would overwrite the truth: a message the
 * recipient definitely received would go back to reading "sent".
 *
 * So every status has a rank and a write is only allowed to increase it.
 * Terminal states (bounced, failed) outrank delivered because they are
 * evidence of a problem and nothing later should be able to paper over one.
 */

/** Events Resend sends about an outbound message. */
export type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.complained"
  | "email.opened"
  | "email.clicked";

/**
 * How far along the delivery each status is. Higher wins.
 *
 * `bounced` and `failed` sit at the top, above `delivered`, on purpose. A
 * message can be accepted by the receiving server and bounce afterwards
 * (mailbox full, address disabled), and that later bounce is the fact that
 * matters — it means the person did not get it and we must stop writing to
 * that address.
 */
export const RANK: Record<DeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  failed: 3,
  bounced: 4,
};

/**
 * What an event means for our status, or null for events that say nothing
 * about deliverability.
 *
 * `email.opened` and `email.clicked` are deliberately null. They are
 * engagement, not delivery, and they are unreliable — an image proxy or a
 * corporate link scanner "opens" and "clicks" mail nobody has looked at.
 * Recording those as delivery state would make the thread claim a customer
 * read a message when a security appliance fetched it. Open and click tracking
 * is PIVOT 23 and belongs in its own columns, not this one.
 *
 * `email.complained` is null HERE for the same kind of reason: a spam
 * complaint is not a delivery failure — the message arrived, that is how they
 * complained about it. It belongs in the suppression list, which is a separate
 * path.
 */
export function statusForEvent(type: string): DeliveryStatus | null {
  switch (type) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.failed":
      return "failed";
    // Explicitly NOT a status change. A delay is still in flight.
    case "email.delivery_delayed":
      return null;
    default:
      return null;
  }
}

/**
 * May `next` replace `current`?
 *
 * A null current is a message we have no status for yet, so anything is an
 * improvement.
 */
export function canAdvance(
  current: DeliveryStatus | null,
  next: DeliveryStatus,
): boolean {
  if (current === null) return true;
  return RANK[next] > RANK[current];
}

/**
 * Does this event mean the address should stop being written to?
 *
 * Only a hard bounce and a complaint. A delivery delay is temporary and a
 * soft bounce is somebody's mailbox being full for a week — suppressing on
 * either would cost a customer their support thread over a transient problem.
 */
export function shouldSuppressAddress(
  type: string,
  bounceType: string | null | undefined,
): boolean {
  if (type === "email.complained") return true;
  if (type !== "email.bounced") return false;
  // Resend reports "Permanent" / "Transient" (and sometimes "Undetermined").
  // Only the first is grounds for never writing again; treating an
  // undetermined bounce as permanent would silently cut people off.
  return (bounceType ?? "").toLowerCase() === "permanent";
}

/** What the thread shows on an outbound bubble. Null renders nothing. */
export function describeDeliveryStatus(
  status: DeliveryStatus | null,
): string | null {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "bounced":
      // Named plainly. "Not delivered" would be softer and would leave
      // somebody waiting for a reply that cannot come.
      return "Bounced — it did not arrive";
    case "failed":
      return "Failed to send";
    case "sent":
      return "Sent";
    case "queued":
      return "Queued";
    default:
      return null;
  }
}
