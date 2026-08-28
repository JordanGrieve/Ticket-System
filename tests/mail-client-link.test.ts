import { describe, it, expect } from "vitest";
import { gmailSearchUrl, canOpenInMailClient } from "../lib/mail-client-link";

/**
 * The "open it in Gmail" link.
 *
 * The property worth protecting is that it is never offered when it cannot
 * work. A control that reliably finds nothing teaches people to distrust the
 * ones that do work, and this one has three separate ways of not applying.
 */

describe("when there is nothing to link to", () => {
  it("returns null with no message id", () => {
    // Every message in the development database is in this state, and so is
    // any real one whose headers did not carry an id.
    expect(gmailSearchUrl(null)).toBeNull();
  });

  it("returns null for an empty or bracket-only id", () => {
    expect(gmailSearchUrl("")).toBeNull();
    expect(gmailSearchUrl("   ")).toBeNull();
    expect(gmailSearchUrl("<>")).toBeNull();
  });
});

describe("the URL it builds", () => {
  it("strips the angle brackets Gmail does not want", () => {
    const url = gmailSearchUrl("<CAF%3Dabc123@mail.example>");
    expect(url).not.toContain("<");
    expect(url).not.toContain("%3C");
  });

  it("uses the rfc822msgid operator, not a mailbox position", () => {
    // So it finds the message wherever it now lives — inbox, archive or under
    // a label — rather than depending on a location that may have changed.
    expect(gmailSearchUrl("<a@b.example>")).toContain("rfc822msgid");
  });

  it("encodes an id containing characters that would break the URL", () => {
    // Real Message-IDs contain +, =, / and % often enough to matter, and an
    // unencoded one silently searches for the wrong string.
    const url = gmailSearchUrl("<a+b/c=d@mail.example>")!;
    expect(url).not.toMatch(/[+/=]@/);
    expect(decodeURIComponent(url.split("#search/")[1])).toBe(
      "rfc822msgid:a+b/c=d@mail.example",
    );
  });
});

describe("which tickets are offered the link", () => {
  it("offers it for mail that really was mail", () => {
    expect(
      canOpenInMailClient({ source: "email", messageId: "<a@b.example>" }),
    ).toBe(true);
  });

  it("NEVER offers it for a contact-form ticket", () => {
    // A form submission arrived as an HTTP POST. It has never been an email
    // and has never been in anybody's mailbox, so there is nothing to open —
    // even in the odd case that a message id got attached to it.
    expect(
      canOpenInMailClient({
        source: "contact_form",
        messageId: "<somehow@present.example>",
      }),
    ).toBe(false);
  });

  it("does not offer it for email with no id captured", () => {
    expect(canOpenInMailClient({ source: "email", messageId: null })).toBe(
      false,
    );
  });

  it("offers it for an order ticket that arrived by email", () => {
    // Order tickets are classified from the subject of a real email, so the
    // message does exist in their mailbox.
    expect(
      canOpenInMailClient({ source: "order", messageId: "<x@y.example>" }),
    ).toBe(true);
  });
});
