import { describe, it, expect } from "vitest";
import {
  statusForEvent,
  canAdvance,
  shouldSuppressAddress,
  describeDeliveryStatus,
} from "../lib/delivery-events";

/**
 * Provider delivery events.
 *
 * The properties worth protecting are about ORDER and about not overclaiming.
 * Webhooks arrive out of order and are retried, and the thread shows the
 * result to somebody deciding whether their customer heard from them.
 */

describe("events that change delivery status", () => {
  it("maps the ones that mean something", () => {
    expect(statusForEvent("email.sent")).toBe("sent");
    expect(statusForEvent("email.delivered")).toBe("delivered");
    expect(statusForEvent("email.bounced")).toBe("bounced");
    expect(statusForEvent("email.failed")).toBe("failed");
  });

  it("ignores opens and clicks", () => {
    // Engagement, not delivery, and unreliable: an image proxy or a corporate
    // link scanner "opens" and "clicks" mail nobody has looked at. Recording
    // those here would make a thread claim a customer read something when a
    // security appliance fetched it.
    expect(statusForEvent("email.opened")).toBeNull();
    expect(statusForEvent("email.clicked")).toBeNull();
  });

  it("ignores a delivery delay", () => {
    // Still in flight. Downgrading to a scary state because a receiving server
    // is slow would have somebody chasing a customer for nothing.
    expect(statusForEvent("email.delivery_delayed")).toBeNull();
  });

  it("ignores a complaint", () => {
    // A complaint is not a delivery failure — the message arrived, that is how
    // they complained about it. It belongs in the suppression list.
    expect(statusForEvent("email.complained")).toBeNull();
  });

  it("ignores anything it does not recognise", () => {
    expect(statusForEvent("email.something_new")).toBeNull();
    expect(statusForEvent("")).toBeNull();
  });
});

describe("status only ever moves forward", () => {
  it("accepts anything when there is no status yet", () => {
    expect(canAdvance(null, "sent")).toBe(true);
    expect(canAdvance(null, "bounced")).toBe(true);
  });

  it("advances sent → delivered", () => {
    expect(canAdvance("sent", "delivered")).toBe(true);
  });

  it("REFUSES delivered → sent", () => {
    // The whole reason ordering is enforced. Resend retries, and `email.sent`
    // can land after `email.delivered` for the same message. Without this a
    // message the recipient definitely received goes back to reading "sent".
    expect(canAdvance("delivered", "sent")).toBe(false);
  });

  it("lets a bounce overrule a delivery", () => {
    // A message can be accepted by the receiving server and bounce afterwards
    // — mailbox full, address disabled. That later bounce is the fact that
    // matters: the person did not get it.
    expect(canAdvance("delivered", "bounced")).toBe(true);
  });

  it("never lets anything overwrite a bounce", () => {
    // Evidence of a problem. Nothing arriving later should paper over one.
    for (const s of ["queued", "sent", "delivered", "failed"] as const) {
      expect(canAdvance("bounced", s)).toBe(false);
    }
  });

  it("refuses to rewrite a status with itself", () => {
    // Idempotency: a redelivered webhook must be a no-op, not a write.
    for (const s of ["queued", "sent", "delivered", "bounced", "failed"] as const) {
      expect(canAdvance(s, s)).toBe(false);
    }
  });
});

describe("when an address should stop being written to", () => {
  it("suppresses on a permanent bounce", () => {
    expect(shouldSuppressAddress("email.bounced", "Permanent")).toBe(true);
    expect(shouldSuppressAddress("email.bounced", "permanent")).toBe(true);
  });

  it("suppresses on a complaint", () => {
    expect(shouldSuppressAddress("email.complained", null)).toBe(true);
  });

  it("does NOT suppress on a transient bounce", () => {
    // Somebody's mailbox is full for a week. Suppressing would cost them their
    // support thread over a temporary problem, and suppression is not
    // something the product undoes on its own.
    expect(shouldSuppressAddress("email.bounced", "Transient")).toBe(false);
  });

  it("does NOT suppress on an undetermined bounce", () => {
    // Treating "we are not sure" as permanent silently cuts people off.
    expect(shouldSuppressAddress("email.bounced", "Undetermined")).toBe(false);
    expect(shouldSuppressAddress("email.bounced", null)).toBe(false);
  });

  it("does not suppress on delivery or a delay", () => {
    expect(shouldSuppressAddress("email.delivered", null)).toBe(false);
    expect(shouldSuppressAddress("email.delivery_delayed", null)).toBe(false);
  });
});

describe("what the thread shows", () => {
  it("names a bounce plainly rather than softening it", () => {
    // "Not delivered" would be gentler and would leave somebody waiting for a
    // reply that cannot come.
    expect(describeDeliveryStatus("bounced")).toMatch(/did not arrive/i);
  });

  it("renders nothing for a message with no status", () => {
    // Inbound messages have null here, and null means "not applicable".
    expect(describeDeliveryStatus(null)).toBeNull();
  });

  it("has words for every status", () => {
    for (const s of ["queued", "sent", "delivered", "bounced", "failed"] as const) {
      expect(describeDeliveryStatus(s)).toBeTruthy();
    }
  });
});
