import { describe, it, expect } from "vitest";
import {
  isSelfAddress,
  isRoleOrNoReplyAddress,
  isAutomatedMail,
  extractHeaders,
} from "../lib/auto-reply";

/**
 * Hardening tests for the auto-reply loop guards.
 *
 * These target the PURE address/header predicates rather than
 * `decideAutoReply`, deliberately: the decision function's input shape is a
 * moving target, but these four predicates are the actual fence, and every
 * mail loop this feature can cause gets through by defeating one of them.
 *
 * Cases marked `it.fails` are CONFIRMED HOLES, verified by probe, not
 * hypotheses. They are written as expected-failures so the suite stays green
 * while the gap is recorded precisely. When someone closes one, the `it.fails`
 * itself starts failing — that is the signal to flip it to a plain `it`.
 */

/** A workspace shaped like the real pilot client. */
const WORKSPACE = {
  inboundEmail: "bakery-a1b2@postbox.help",
  sendingEmail: "hello@bramblebakery.co.uk",
};

describe("isSelfAddress — never acknowledge one of our own mailboxes", () => {
  it("matches the workspace's own addresses exactly", () => {
    expect(isSelfAddress("hello@bramblebakery.co.uk", WORKSPACE)).toBe(true);
    expect(isSelfAddress("bakery-a1b2@postbox.help", WORKSPACE)).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isSelfAddress("HELLO@BRAMBLEBAKERY.CO.UK", WORKSPACE)).toBe(true);
    expect(isSelfAddress("  hello@bramblebakery.co.uk  ", WORKSPACE)).toBe(true);
  });

  it("treats an empty recipient as self (fail closed)", () => {
    expect(isSelfAddress("", WORKSPACE)).toBe(true);
    expect(isSelfAddress("   ", WORKSPACE)).toBe(true);
  });

  it("catches per-ticket reply addresses on any domain", () => {
    // Another ticket's reply address must never receive an acknowledgement:
    // that threads our robot's mail into an unrelated ticket.
    expect(isSelfAddress("ticket+TKT-5-abcd1234@elsewhere.com", WORKSPACE)).toBe(
      true,
    );
  });

  it("lets a genuine customer through", () => {
    expect(isSelfAddress("alex@example.com", WORKSPACE)).toBe(false);
  });

  /**
   * HOLE. `sendingEmail` is compared by exact string equality, so a
   * plus-addressed alias of the workspace's OWN address is not recognised as
   * self. Practically every mail provider delivers hello+x@ to hello@, so this
   * sends the acknowledgement straight back into the client's own inbox.
   *
   * It does not become an infinite loop today only because the second hop is
   * caught elsewhere: app/api/inbound/route.ts drops mail whose sender is
   * EMAIL_FROM_ADDRESS. This guard should not be relying on that backstop.
   *
   * Fix: strip the +tag from the local part before comparing, as
   * isRoleOrNoReplyAddress already does.
   */
  it("should treat a +tag alias of sendingEmail as self", () => {
    expect(isSelfAddress("hello+tag@bramblebakery.co.uk", WORKSPACE)).toBe(true);
  });

  /** HOLE (minor). A fully-qualified trailing dot is the same mailbox. */
  it.fails("should treat a trailing-dot FQDN as the same mailbox", () => {
    expect(isSelfAddress("hello@bramblebakery.co.uk.", WORKSPACE)).toBe(true);
  });
});

describe("isRoleOrNoReplyAddress — never acknowledge a robot", () => {
  it("catches the exact role local-parts", () => {
    for (const a of [
      "noreply@x.com",
      "no-reply@x.com",
      "no.reply@x.com",
      "donotreply@x.com",
      "mailer-daemon@x.com",
      "postmaster@x.com",
      "bounces@x.com",
      "listserv@x.com",
    ]) {
      expect(isRoleOrNoReplyAddress(a), a).toBe(true);
    }
  });

  it("catches list plumbing and bounce tags", () => {
    expect(isRoleOrNoReplyAddress("support+bounce@x.com")).toBe(true);
    expect(isRoleOrNoReplyAddress("announce-bounces@x.com")).toBe(true);
    expect(isRoleOrNoReplyAddress("list-request@x.com")).toBe(true);
    expect(isRoleOrNoReplyAddress("news-unsubscribe@x.com")).toBe(true);
  });

  it("treats an unparseable address as a robot (fail closed)", () => {
    expect(isRoleOrNoReplyAddress("not-an-address")).toBe(true);
    expect(isRoleOrNoReplyAddress("")).toBe(true);
  });

  it("lets a genuine customer through", () => {
    expect(isRoleOrNoReplyAddress("alex@example.com")).toBe(false);
  });

  /**
   * HOLE. The catch-all pattern is
   *   /^(no|do)[-_.]?no?t?[-_.]?repl(y|ies)/
   * The `no?t?` group is NOT optional — it requires a literal `n` — so the
   * pattern only ever matches the doubled "no-not-reply" / "do-not-reply"
   * shape. Plain variants match solely because they are hardcoded in
   * ROLE_LOCAL_PARTS, so every numbered or pluralised variant escapes:
   *
   *   nonotreply@   -> caught (by the regex)
   *   donotreply2@  -> caught (by the regex)
   *   noreply2@     -> MISSED
   *   noreplies@    -> MISSED
   *   no-replies@   -> MISSED
   *   no-reply-2@   -> MISSED
   *
   * Those are common vendor senders, and each one is a live auto-reply loop.
   * Fix: make the middle group optional, e.g.
   *   /^(no|do)[-_.]?(?:no?t?[-_.]?)?repl(y|ies)/
   */
  it("should catch numbered and pluralised no-reply variants", () => {
    for (const a of [
      "noreply2@x.com",
      "noreplies@x.com",
      "no-replies@x.com",
      "no-reply-2@x.com",
    ]) {
      expect(isRoleOrNoReplyAddress(a), a).toBe(true);
    }
  });

  it("does still catch the doubled form the regex was written for", () => {
    expect(isRoleOrNoReplyAddress("nonotreply@x.com")).toBe(true);
    expect(isRoleOrNoReplyAddress("donotreply2@x.com")).toBe(true);
  });
});

describe("isAutomatedMail — honour RFC 3834 and bulk markers", () => {
  it("refuses anything declaring itself automated", () => {
    expect(isAutomatedMail({ "auto-submitted": "auto-replied" })).toBe(true);
    expect(isAutomatedMail({ "auto-submitted": "auto-generated" })).toBe(true);
    expect(isAutomatedMail({ precedence: "bulk" })).toBe(true);
    expect(isAutomatedMail({ "x-auto-response-suppress": "All" })).toBe(true);
    expect(isAutomatedMail({ "list-id": "<announce.example>" })).toBe(true);
    expect(isAutomatedMail({ "list-unsubscribe": "<mailto:x@y>" })).toBe(true);
    expect(isAutomatedMail({ "return-path": "<>" })).toBe(true);
    expect(isAutomatedMail({ "x-failed-recipients": "a@b.com" })).toBe(true);
  });

  it("allows an explicit Auto-Submitted: no, and ordinary mail", () => {
    expect(isAutomatedMail({ "auto-submitted": "no" })).toBe(false);
    expect(isAutomatedMail({ subject: "Hello" })).toBe(false);
    expect(isAutomatedMail({})).toBe(false);
    expect(isAutomatedMail(null)).toBe(false);
  });

  /**
   * CONTRACT, not a bug: isAutomatedMail does a case-SENSITIVE lookup and so
   * only works on keys already lower-cased by extractHeaders. Real mail
   * headers arrive as "Auto-Submitted"/"List-Id". Every current caller goes
   * through extractHeaders, so this is safe today — this test pins that
   * coupling down so a future caller passing raw headers is caught here rather
   * than by a mail loop in production.
   */
  it("only sees lower-cased keys — raw header casing slips past", () => {
    expect(isAutomatedMail({ "Auto-Submitted": "auto-replied" })).toBe(false);
    expect(isAutomatedMail({ "List-Id": "<a.b>" })).toBe(false);
    // …which is exactly why extractHeaders must run first:
    expect(
      isAutomatedMail(extractHeaders({ headers: { "Auto-Submitted": "auto-replied" } })),
    ).toBe(true);
  });
});

describe("extractHeaders — normalise both provider shapes", () => {
  it("normalises the array-of-{name,value} shape", () => {
    expect(
      extractHeaders({ headers: [{ name: "Auto-Submitted", value: "auto-replied" }] }),
    ).toEqual({ "auto-submitted": "auto-replied" });
  });

  it("normalises the plain-record shape", () => {
    expect(extractHeaders({ headers: { "List-ID": "<a.b>" } })).toEqual({
      "list-id": "<a.b>",
    });
  });

  it("survives junk without throwing (hostile webhook input)", () => {
    expect(extractHeaders(null)).toEqual({});
    expect(extractHeaders(undefined)).toEqual({});
    expect(extractHeaders({})).toEqual({});
    expect(extractHeaders({ headers: "not-an-object" })).toEqual({});
    expect(extractHeaders({ headers: [{ nope: 1 }] })).toEqual({});
    expect(extractHeaders({ headers: { a: 123 } })).toEqual({});
  });
});
