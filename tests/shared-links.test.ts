import { describe, it, expect } from "vitest";
import {
  extractSharedLinks,
  trimUrlPunctuation,
  sharedLinksTruncated,
  MAX_SHARED_LINKS,
  type LinkSource,
} from "../lib/shared-links";

/**
 * Links pulled out of messages strangers sent through a public contact form,
 * and shown to the business owner as things to click.
 *
 * That sentence is the whole threat model, and most of these tests are about
 * it rather than about extraction being tidy.
 */

const msg = (over: Partial<LinkSource> = {}): LinkSource => ({
  ticketId: 1,
  body: "",
  createdAtIso: "2026-08-23T10:00:00.000Z",
  direction: "inbound",
  ...over,
});

describe("what may become a clickable link", () => {
  it("takes http and https", () => {
    const links = extractSharedLinks([
      msg({ body: "See https://example.com/a and http://example.org/b" }),
    ]);
    expect(links.map((l) => l.url)).toEqual([
      "https://example.com/a",
      "http://example.org/b",
    ]);
  });

  it("REFUSES javascript: and data: URLs", () => {
    // The one that matters. A javascript: URL reaching an href is script
    // execution in the business owner's session, typed by a stranger into a
    // public form. The pattern is scheme-anchored so these never match at all.
    const links = extractSharedLinks([
      msg({
        body: "javascript:alert(1) data:text/html;base64,PHN2Zz4= vbscript:msgbox(1)",
      }),
    ]);
    expect(links).toEqual([]);
  });

  it("does not invent a scheme for a bare domain", () => {
    // Friendlier to linkify "www.example.com", and wrong: it turns any
    // sentence mentioning a domain into a link and requires guessing http vs
    // https on the reader's behalf.
    expect(extractSharedLinks([msg({ body: "we are at www.example.com" })])).toEqual(
      [],
    );
  });

  it("drops anything it cannot parse", () => {
    const links = extractSharedLinks([msg({ body: "https://" })]);
    expect(links).toEqual([]);
  });
});

describe("where the sentence ends and the URL stops", () => {
  it("strips trailing sentence punctuation", () => {
    expect(trimUrlPunctuation("https://example.com/page.")).toBe(
      "https://example.com/page",
    );
    expect(trimUrlPunctuation("https://example.com/a,")).toBe(
      "https://example.com/a",
    );
    expect(trimUrlPunctuation("https://example.com/a?b=1!")).toBe(
      "https://example.com/a?b=1",
    );
  });

  it("keeps a closing bracket that belongs to the URL", () => {
    // Wikipedia-style URLs really do end in ")". Trimming it blindly produces
    // a link that 404s, which looks like the product losing part of a message.
    expect(
      trimUrlPunctuation("https://en.wikipedia.org/wiki/Foo_(bar)"),
    ).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  it("drops a closing bracket that belongs to the sentence", () => {
    expect(trimUrlPunctuation("https://example.com/a)")).toBe(
      "https://example.com/a",
    );
  });
});

describe("the list itself", () => {
  it("shows the destination host, not whatever the message called it", () => {
    // A stranger's link labelled "your invoice" pointing at another host is
    // the oldest trick there is. The host is what the UI leads with.
    const [link] = extractSharedLinks([
      msg({ body: "https://tracking.evil.example/click?to=bank" }),
    ]);
    expect(link.hostname).toBe("tracking.evil.example");
  });

  it("deduplicates, keeping the most recent occurrence", () => {
    const links = extractSharedLinks([
      msg({ body: "https://example.com/x", createdAtIso: "2026-08-01T09:00:00.000Z" }),
      msg({ body: "https://example.com/x", createdAtIso: "2026-08-20T09:00:00.000Z" }),
    ]);
    expect(links).toHaveLength(1);
    // The recent one is the one somebody wants to open.
    expect(links[0].atIso).toBe("2026-08-20T09:00:00.000Z");
  });

  it("orders newest first", () => {
    const links = extractSharedLinks([
      msg({ body: "https://old.example", createdAtIso: "2026-08-01T09:00:00.000Z" }),
      msg({ body: "https://new.example", createdAtIso: "2026-08-22T09:00:00.000Z" }),
    ]);
    expect(links.map((l) => l.hostname)).toEqual(["new.example", "old.example"]);
  });

  it("records who sent it", () => {
    const links = extractSharedLinks([
      msg({ body: "https://a.example", direction: "inbound" }),
      msg({
        body: "https://b.example",
        direction: "outbound",
        createdAtIso: "2026-08-22T09:00:00.000Z",
      }),
    ]);
    // A link the customer sent is not the same thing as one we sent them.
    expect(links.find((l) => l.hostname === "a.example")?.fromCustomer).toBe(true);
    expect(links.find((l) => l.hostname === "b.example")?.fromCustomer).toBe(false);
  });

  it("caps the list and says so", () => {
    const body = Array.from(
      { length: MAX_SHARED_LINKS + 10 },
      (_, i) => `https://example.com/${i}`,
    ).join(" ");
    const links = extractSharedLinks([msg({ body })]);
    expect(links).toHaveLength(MAX_SHARED_LINKS);
    // Silently stopping at twenty looks exactly like a complete list of twenty.
    expect(sharedLinksTruncated(links)).toBe(true);
  });

  it("is empty for messages with no links, without throwing", () => {
    expect(extractSharedLinks([])).toEqual([]);
    expect(extractSharedLinks([msg({ body: "no links here at all" })])).toEqual([]);
  });
});
