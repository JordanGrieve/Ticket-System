import { describe, it, expect } from "vitest";
import { detectEmailTypo, describeEmailTypo } from "../lib/email-typo";

/**
 * Obvious address typos.
 *
 * Most of these tests are about what this must NOT flag. It runs against real
 * customers' addresses, and a false positive tells a business their customer's
 * perfectly good email is broken — which is worse than the bounce it was
 * trying to prevent, because somebody acts on it.
 */

describe("the case that prompted this", () => {
  it("catches the .comf that was accepted on 22 August", () => {
    const typo = detectEmailTypo("jordangrieve.dev@gmail.comf");
    expect(typo).not.toBeNull();
    expect(typo?.suggestion).toBe("jordangrieve.dev@gmail.com");
  });

  it("explains it in terms a business can act on", () => {
    const text = describeEmailTypo(detectEmailTypo("a@b.comf")!);
    expect(text).toMatch(/will not arrive/i);
    expect(text).toMatch(/a@b\.com/);
  });
});

describe("high-confidence slips", () => {
  it.each([
    ["someone@example.con", "someone@example.com"],
    ["someone@example.cmo", "someone@example.com"],
    ["someone@example.ner", "someone@example.net"],
    ["someone@example.ogr", "someone@example.org"],
    ["priya@gmial.com", "priya@gmail.com"],
    ["priya@gnail.com", "priya@gmail.com"],
    ["priya@hotmial.com", "priya@hotmail.com"],
    ["priya@yaho.com", "priya@yahoo.com"],
  ])("flags %s and suggests %s", (bad, fixed) => {
    expect(detectEmailTypo(bad)?.suggestion).toBe(fixed);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(detectEmailTypo("  Priya@GMIAL.com  ")?.suggestion).toBe(
      "priya@gmail.com",
    );
  });
});

describe("what it must never flag", () => {
  /*
   * The important half. A false positive tells a bakery their customer's
   * address is broken when it is not, and somebody rings a customer to correct
   * an email that was already right.
   */
  it.each([
    "priya.raman@gmail.com",
    "tom@opendoorbakery.co.uk",
    "hello@example.org",
    "a@b.net",
    "someone@sub.domain.example.com",
    "person@example.io",
    "person@example.dev",
    "person@example.app",
    "person@example.bakery",
    "person@example.london",
    // Newer and less common TLDs, the exact category an IANA allowlist would
    // have rejected the day it went stale.
    "person@example.pizza",
    "person@example.みんな",
    "person@example.xn--q9jyb4c",
  ])("passes %s", (good) => {
    expect(detectEmailTypo(good)).toBeNull();
  });

  it("passes an address it cannot parse rather than guessing", () => {
    // Not this module's job. looksLikeEmail already refuses these, and a
    // second opinion that disagrees is how two checks drift apart.
    for (const junk of ["", "   ", "no-at-sign", "@", "trailing@"]) {
      expect(detectEmailTypo(junk)).toBeNull();
    }
  });

  it("never flags a domain with no dot", () => {
    // Intranet-style addresses are legal and are somebody's problem, not a
    // typo this module can claim to have spotted.
    expect(detectEmailTypo("root@localhost")).toBeNull();
  });
});

describe("it is not a validator", () => {
  it("returns null for a syntactically fine but certainly dead address", () => {
    // The contract: null means "not obviously wrong", never "deliverable".
    // Anything relying on it as proof of delivery is misreading it, which is
    // why the module says so in its header too.
    expect(detectEmailTypo("nobody@example.invalid")).toBeNull();
    expect(detectEmailTypo("nobody@thisdomaindoesnotexist.com")).toBeNull();
  });
});
