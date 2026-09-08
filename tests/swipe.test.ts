import { describe, it, expect } from "vitest";
import {
  claimSwipe,
  swipeOffset,
  shouldStayOpen,
  REVEAL_PX,
  OVERSHOOT_PX,
  CLAIM_PX,
} from "../lib/swipe";

describe("claiming the gesture", () => {
  it("stays undecided inside the dead zone, so a tap is still a tap", () => {
    expect(claimSwipe(0, 0)).toBe("undecided");
    expect(claimSwipe(CLAIM_PX - 1, CLAIM_PX - 1)).toBe("undecided");
  });

  it("gives a clear sideways drag to the swipe", () => {
    expect(claimSwipe(-30, 4)).toBe("horizontal");
  });

  it("gives a clear downward drag to the page", () => {
    expect(claimSwipe(3, 30)).toBe("vertical");
  });

  it("biases a diagonal toward scrolling, which is the common gesture", () => {
    // Equal travel on both axes is NOT ours: the list scroll wins ties.
    expect(claimSwipe(-20, 20)).toBe("vertical");
    // Only clearly more sideways than down is a swipe.
    expect(claimSwipe(-26, 20)).toBe("horizontal");
  });
});

describe("where the card sits", () => {
  it("follows a leftward drag exactly, from closed", () => {
    expect(swipeOffset(-40, false)).toBe(-40);
    expect(swipeOffset(-REVEAL_PX, false)).toBe(-REVEAL_PX);
  });

  it("starts from the revealed position when already open", () => {
    expect(swipeOffset(0, true)).toBe(-REVEAL_PX);
    expect(swipeOffset(REVEAL_PX, true)).toBe(0);
  });

  it("refuses to move right of closed", () => {
    expect(swipeOffset(50, false)).toBe(0);
    expect(swipeOffset(REVEAL_PX + 80, true)).toBe(0);
  });

  it("rubber-bands past the reveal point and caps", () => {
    const past = swipeOffset(-REVEAL_PX - 30, false);
    expect(past).toBeLessThan(-REVEAL_PX);
    expect(past).toBe(-REVEAL_PX - 10);
    expect(swipeOffset(-REVEAL_PX - 900, false)).toBe(-REVEAL_PX - OVERSHOOT_PX);
  });
});

describe("on release", () => {
  it("snaps shut short of halfway", () => {
    expect(shouldStayOpen(-REVEAL_PX / 2 + 1)).toBe(false);
    expect(shouldStayOpen(0)).toBe(false);
  });

  it("stays open from halfway on", () => {
    expect(shouldStayOpen(-REVEAL_PX / 2)).toBe(true);
    expect(shouldStayOpen(-REVEAL_PX)).toBe(true);
  });
});
