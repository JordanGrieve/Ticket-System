import { describe, it, expect } from "vitest";
import {
  formatTicketRef,
  buildReplyTo,
  parseTicketRefFromAddress,
  detectOrderId,
  classifyInbound,
  stripQuotedReply,
  initials,
  relativeTime,
  previewText,
} from "../lib/tickets";

describe("ticket refs & reply addresses", () => {
  it("formats refs", () => {
    expect(formatTicketRef(4821)).toBe("TKT-4821");
  });

  it("builds tokened reply addresses", () => {
    expect(buildReplyTo(18, "9f3a2c1d")).toMatch(
      /^ticket\+TKT-18-9f3a2c1d@/,
    );
  });

  it("builds tokenless addresses when token is null", () => {
    expect(buildReplyTo(18, null)).toMatch(/^ticket\+TKT-18@/);
  });

  it("parses tokened addresses", () => {
    expect(
      parseTicketRefFromAddress("ticket+TKT-42-9f3a2c1d@postbox.help"),
    ).toEqual({ id: 42, token: "9f3a2c1d" });
  });

  it("parses legacy tokenless addresses with a null token", () => {
    expect(parseTicketRefFromAddress("ticket+TKT-42@postbox.help")).toEqual({
      id: 42,
      token: null,
    });
  });

  it("upper-cases in the wild are tolerated, token lower-cased", () => {
    expect(
      parseTicketRefFromAddress("TICKET+tkt-7-ABCDEF12@postbox.help"),
    ).toEqual({ id: 7, token: "abcdef12" });
  });

  it("rejects non-ticket addresses", () => {
    expect(parseTicketRefFromAddress("hello@postbox.help")).toBeNull();
    expect(parseTicketRefFromAddress("ticket+TKT-@postbox.help")).toBeNull();
  });

  it("round-trips build → parse", () => {
    const ref = parseTicketRefFromAddress(buildReplyTo(123, "deadbeef"));
    expect(ref).toEqual({ id: 123, token: "deadbeef" });
  });
});

describe("order detection", () => {
  it("detects ORD ids case-insensitively", () => {
    expect(detectOrderId("about ord-1234 please")).toBe("ORD-1234");
  });

  it("detects #-style ids of 3+ digits", () => {
    expect(detectOrderId("my order #4821 is late")).toBe("#4821");
    expect(detectOrderId("ticket #12 is short")).toBeNull();
  });

  it("classifies inbound with an order id as order source", () => {
    expect(classifyInbound("Re: order", "ORD-99 missing")).toEqual({
      source: "order",
      orderId: "ORD-99",
    });
  });

  it("classifies plain email as email source", () => {
    expect(classifyInbound("hello", "just a question")).toEqual({
      source: "email",
      orderId: null,
    });
  });
});

describe("stripQuotedReply", () => {
  it("cuts single-line Gmail attribution", () => {
    expect(
      stripQuotedReply(
        "thanks!\n\nOn Sat, Jul 11, 2026 at 1:53 PM X <a@b.c> wrote:\n> earlier",
      ),
    ).toBe("thanks!");
  });

  it("cuts Gmail's line-wrapped attribution", () => {
    expect(
      stripQuotedReply(
        "r322342344\n\nOn Sat, Jul 11, 2026 at 1:52 PM Open Door Bakery <replies@postbox.help>\nwrote:\n\n> wwewsdggdfr\n>",
      ),
    ).toBe("r322342344");
  });

  it("drops mobile signatures", () => {
    expect(stripQuotedReply("ok\n\nSent from Yahoo Mail for iPhone")).toBe("ok");
  });

  it("cuts Outlook original-message blocks", () => {
    expect(
      stripQuotedReply("sure\n\n-----Original Message-----\nFrom: x@y.z"),
    ).toBe("sure");
  });

  it("keeps sentences that merely start with On", () => {
    const text = "On Monday I want two cakes.\nIs that possible?";
    expect(stripQuotedReply(text)).toBe(text);
  });

  it("never returns empty — falls back to the original", () => {
    const quoteOnly = "On Sat, Jul 11, 2026 at 1:52 PM B <x@y.z> wrote:\n> hi";
    expect(stripQuotedReply(quoteOnly)).toBe(quoteOnly);
  });
});

describe("display helpers", () => {
  it("initials from names", () => {
    expect(initials("Maria Alvarez")).toBe("MA");
    expect(initials("single")).toBe("S");
    expect(initials("  ")).toBe("?");
  });

  it("relative times", () => {
    const now = new Date("2026-08-01T12:00:00Z");
    expect(relativeTime(new Date("2026-08-01T11:59:40Z"), now)).toBe("now");
    expect(relativeTime(new Date("2026-08-01T11:20:00Z"), now)).toBe("40m");
    expect(relativeTime(new Date("2026-08-01T03:00:00Z"), now)).toBe("9h");
    expect(relativeTime(new Date("2026-07-25T12:00:00Z"), now)).toBe("1w");
  });

  it("preview text collapses whitespace and truncates with an ellipsis", () => {
    expect(previewText("a\n b\tc")).toBe("a b c");
    const long = "x".repeat(200);
    const preview = previewText(long, 50);
    expect(preview.length).toBe(50);
    expect(preview.endsWith("…")).toBe(true);
  });
});
