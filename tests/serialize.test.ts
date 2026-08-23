import { describe, it, expect } from "vitest";
import { formatDateTime, toTicketDTO, toMessageDTO } from "../lib/serialize";
import type { Ticket, TicketMessage } from "../db/schema";

describe("formatDateTime", () => {
  const now = new Date("2026-08-01T15:00:00");

  it("labels same-day as Today", () => {
    expect(formatDateTime(new Date("2026-08-01T09:24:00"), now)).toMatch(
      /^Today, /,
    );
  });

  it("labels previous day as Yesterday", () => {
    expect(formatDateTime(new Date("2026-07-31T17:02:00"), now)).toMatch(
      /^Yesterday, /,
    );
  });

  it("labels 2-6 days back as N days ago", () => {
    expect(formatDateTime(new Date("2026-07-29T10:00:00"), now)).toMatch(
      /^3 days ago, /,
    );
  });

  it("falls back to a date for older messages", () => {
    expect(formatDateTime(new Date("2026-07-03T16:12:00"), now)).toMatch(
      /^3 Jul, /,
    );
  });
});

describe("DTO mapping", () => {
  const ticket: Ticket = {
    id: 18,
    workspaceId: 1,
    source: "order",
    replyToken: "9f3a2c1d",
    orderId: "ORD-7",
    formId: null,
    customerName: "Sharon",
    customerEmail: "s@example.com",
    subject: "Cakes",
    status: "open",
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    deletedAt: null,
    deletedBy: null,
  };

  it("maps tickets with a ref and relative time", () => {
    const dto = toTicketDTO(ticket, new Date("2026-08-01T11:00:00Z"));
    expect(dto.ref).toBe("TKT-18");
    expect(dto.timeShort).toBe("1h");
    expect(dto.orderId).toBe("ORD-7");
  });

  it("ships ISO timestamps on messages (client formats them)", () => {
    const msg: TicketMessage = {
      id: 1,
      ticketId: 18,
      direction: "inbound",
      body: "hi",
      // Meaningless on inbound — nothing we generated. See ticket_messages.
      automated: false,
      messageId: null,
      deliveryStatus: null,
      providerMessageId: null,
      sentAt: new Date("2026-08-01T10:30:00Z"),
    };
    expect(toMessageDTO(msg).sentAtIso).toBe("2026-08-01T10:30:00.000Z");
  });
});
