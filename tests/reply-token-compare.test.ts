import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateReplyToken, tokensEqual } from "@/lib/tokens";

/**
 * The reply token is the only thing between a public mail endpoint and
 * another tenant's ticket thread. Everything else the product verifies is
 * compared in constant time; this pins the reply token to the same bar, and
 * pins the inbound route to actually using it rather than a bare `===`.
 */
describe("reply token comparison", () => {
  it("accepts an identical token", () => {
    const t = generateReplyToken();
    expect(tokensEqual(t, t)).toBe(true);
  });

  it("rejects a token that differs in its last character", () => {
    const t = generateReplyToken();
    const flipped = t.slice(0, -1) + (t.endsWith("0") ? "1" : "0");
    expect(tokensEqual(flipped, t)).toBe(false);
  });

  it("rejects a shorter token without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the helper must not.
    const t = generateReplyToken();
    expect(tokensEqual(t.slice(0, 8), t)).toBe(false);
    expect(tokensEqual("", t)).toBe(false);
  });

  it("is what the inbound route uses to match a reply address", () => {
    const src = readFileSync("app/api/inbound/route.ts", "utf8");
    expect(src).toContain("tokensEqual(ref.token, ticket.replyToken)");
    expect(src).not.toContain("ref.token === ticket.replyToken");
  });
});
