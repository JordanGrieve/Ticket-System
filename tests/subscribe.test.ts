import { describe, it, expect } from "vitest";
import {
  CONFIRM_TOKEN_TTL_MS,
  CONSENT_SOURCE_MAX,
  HONEYPOT_FIELDS,
  SUBSCRIBER_NAME_MAX,
  confirmUrl,
  consentSourceFrom,
  decodeConfirmToken,
  encodeConfirmToken,
  hostedSignupUrl,
  isHoneypotTripped,
  parseSignupInput,
  type ConfirmPayload,
} from "../lib/subscribe";

/**
 * The newsletter signup rules, proved without a database.
 *
 * lib/subscribe.ts was written pure for exactly this: it decides whether a
 * stranger's POST becomes a subscriber, it takes its signing key as an
 * argument rather than reading one, and it therefore runs in CI with no
 * DATABASE_URL and no secrets. That was the stated reason for the split — so
 * the file having had no tests was the one thing the design was for.
 *
 * The confirmation token is the whole security model of this feature. There is
 * no pending-subscriber row: possession of a validly signed token IS the claim
 * that a human pressed a link in a mailbox they control. If a token can be
 * forged or replayed, every consent record downstream is worthless, and the
 * consent records are the only thing standing between this product and an
 * unlawful send. Hence the weight of the forgery cases below.
 */

const SECRET = "test-secret-at-least-sixteen-chars-long";
const OTHER_SECRET = "different-secret-also-long-enough-x";

function payload(over: Partial<ConfirmPayload> = {}): ConfirmPayload {
  return {
    workspaceId: 12,
    email: "reader@example.com",
    name: "Reader",
    consentSource: "https://opendoorbakery.com/newsletter",
    issuedAt: 1_700_000_000_000,
    nonce: "0123456789abcdef0123456789abcdef",
    ...over,
  };
}

describe("confirmation token — round trip", () => {
  it("returns every field it was given", () => {
    const p = payload();
    const result = decodeConfirmToken(
      encodeConfirmToken(p, SECRET),
      SECRET,
      p.issuedAt,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual(p);
  });

  it("carries a null name and a null consent source through unchanged", () => {
    // Null is a real answer for both — an address given without a name, and a
    // submission whose referrer policy stripped the page. Neither may come
    // back as an empty string, which would later read as evidence we have a
    // value when we do not.
    const p = payload({ name: null, consentSource: null });
    const result = decodeConfirmToken(
      encodeConfirmToken(p, SECRET),
      SECRET,
      p.issuedAt,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.name).toBeNull();
      expect(result.payload.consentSource).toBeNull();
    }
  });

  it("gives two signups for one address different tokens", () => {
    // The nonce exists for this. Two identical tokens would mean a link
    // captured once stays valid for every later signup of that address.
    const a = encodeConfirmToken(payload({ nonce: "a".repeat(32) }), SECRET);
    const b = encodeConfirmToken(payload({ nonce: "b".repeat(32) }), SECRET);
    expect(a).not.toEqual(b);
  });

  it("survives a URL round trip", () => {
    // The token is put in a query string and sent through mail clients. If it
    // needed escaping, a real link would break in the wild and not here.
    const token = encodeConfirmToken(payload(), SECRET);
    const url = new URL(confirmUrl("https://postbox.help", token));
    expect(url.searchParams.get("t")).toBe(token);
  });
});

describe("confirmation token — forgery", () => {
  it("rejects a token signed with a different secret", () => {
    const token = encodeConfirmToken(payload(), OTHER_SECRET);
    const result = decodeConfirmToken(token, SECRET, payload().issuedAt);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a payload edited after signing", () => {
    // The attack this is really about: take your own valid token, change the
    // workspace id, and subscribe yourself to somebody else's list — or change
    // the email and subscribe a third party to one.
    const token = encodeConfirmToken(payload(), SECRET);
    const [body, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString());
    decoded.w = 999;
    const tampered =
      Buffer.from(JSON.stringify(decoded)).toString("base64url") +
      "." +
      signature;

    const result = decodeConfirmToken(tampered, SECRET, payload().issuedAt);
    expect(result.ok).toBe(false);
  });

  it("rejects a token with the signature stripped", () => {
    const token = encodeConfirmToken(payload(), SECRET);
    const body = token.split(".")[0];
    expect(decodeConfirmToken(body, SECRET, payload().issuedAt).ok).toBe(false);
    expect(decodeConfirmToken(body + ".", SECRET, payload().issuedAt).ok).toBe(
      false,
    );
  });

  it.each([
    ["empty", ""],
    ["no separator", "abcdefghijklmnop"],
    ["separator first", ".abcdefghijklmnop"],
    ["not base64", "!!!!!!!!.!!!!!!!!"],
    ["not json", Buffer.from("hello").toString("base64url") + ".sig"],
    ["absurdly long", "a".repeat(5000) + ".b"],
  ])("rejects a %s token without throwing", (_label, token) => {
    // This runs on unauthenticated input from the open internet. Every one of
    // these must be an ordinary false, not an exception that becomes a 500.
    expect(() => decodeConfirmToken(token, SECRET)).not.toThrow();
    expect(decodeConfirmToken(token, SECRET).ok).toBe(false);
  });
});

describe("confirmation token — expiry", () => {
  const p = payload();
  const token = encodeConfirmToken(p, SECRET);

  it("accepts a token inside the window", () => {
    const almost = p.issuedAt + CONFIRM_TOKEN_TTL_MS - 1000;
    expect(decodeConfirmToken(token, SECRET, almost).ok).toBe(true);
  });

  it("rejects a token past the window", () => {
    const after = p.issuedAt + CONFIRM_TOKEN_TTL_MS + 1000;
    expect(decodeConfirmToken(token, SECRET, after)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("checks the signature before trusting the expiry in the payload", () => {
    // Order matters. If expiry were read from the payload before the signature
    // were verified, anyone could hand us any issuedAt they liked and mint an
    // immortal link.
    const forged = encodeConfirmToken(
      payload({ issuedAt: 9_999_999_999_999 }),
      OTHER_SECRET,
    );
    expect(decodeConfirmToken(forged, SECRET, p.issuedAt)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("honeypot", () => {
  it("does not trip when the fields are absent", () => {
    // The JSON API is documented without them; a real integration omits them.
    expect(isHoneypotTripped({ email: "a@b.com" })).toBe(false);
  });

  it("does not trip on empty or whitespace", () => {
    // Some browsers autofill a space. Treating that as a bot would silently
    // drop real people, and the endpoint answers a tripped honeypot with a
    // fake success — so the failure would be invisible from both sides.
    for (const field of HONEYPOT_FIELDS) {
      expect(isHoneypotTripped({ [field]: "" })).toBe(false);
      expect(isHoneypotTripped({ [field]: "   " })).toBe(false);
    }
  });

  it("trips on any single filled field", () => {
    for (const field of HONEYPOT_FIELDS) {
      expect(isHoneypotTripped({ [field]: "http://spam.example" })).toBe(true);
    }
  });
});

describe("parseSignupInput", () => {
  it("normalises the address", () => {
    const result = parseSignupInput({ email: "  Reader@Example.COM  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe("reader@example.com");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["no at sign", "reader.example.com"],
    ["no domain", "reader@"],
    ["too long", "a".repeat(250) + "@example.com"],
  ])("rejects a %s address", (_label, email) => {
    expect(parseSignupInput({ email }).ok).toBe(false);
  });

  it("returns null rather than an empty string for a missing name", () => {
    const result = parseSignupInput({ email: "a@b.com", name: "  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBeNull();
  });

  it("drops an address typed into the name box", () => {
    // The commonest form-filler mistake, and it produces "Hi bob@acme.co," at
    // the top of every future campaign — the tell of a spam blast.
    const result = parseSignupInput({
      email: "bob@acme.co",
      name: "bob@acme.co",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBeNull();
  });

  it("caps the name length", () => {
    const result = parseSignupInput({
      email: "a@b.com",
      name: "x".repeat(SUBSCRIBER_NAME_MAX + 50),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).not.toBeNull();
      expect(result.value.name!.length).toBeLessThanOrEqual(
        SUBSCRIBER_NAME_MAX,
      );
    }
  });

  it("does not reject role addresses or repeat signups", () => {
    // Deliberate. Guessing at these rejects real people, and the double opt-in
    // already answers the only question that matters.
    expect(parseSignupInput({ email: "info@example.com" }).ok).toBe(true);
  });
});

describe("consentSourceFrom", () => {
  it("prefers the referrer, because it names the page", () => {
    expect(
      consentSourceFrom({
        origin: "https://opendoorbakery.com",
        referer: "https://opendoorbakery.com/newsletter",
      }),
    ).toBe("https://opendoorbakery.com/newsletter");
  });

  it("falls back to the origin when the referrer was stripped", () => {
    expect(
      consentSourceFrom({ origin: "https://opendoorbakery.com", referer: null }),
    ).toBe("https://opendoorbakery.com/");
  });

  it("drops the query string", () => {
    // It routinely carries session ids, UTM parameters and occasionally the
    // person's own address. None of that is evidence of consent, and all of it
    // would be retained indefinitely on the evidence record.
    expect(
      consentSourceFrom({
        origin: null,
        referer: "https://shop.example/signup?session=abc123&email=bob@x.co",
      }),
    ).toBe("https://shop.example/signup");
  });

  it("returns null when it does not know", () => {
    // NULL IS A VALID ANSWER. Inventing "website form" here would be the
    // backfill db/schema.ts forbids, performed at write time.
    expect(consentSourceFrom({ origin: null, referer: null })).toBeNull();
    expect(consentSourceFrom({ origin: "   ", referer: "" })).toBeNull();
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,hi"],
    ["file", "file:///etc/passwd"],
    ["not a url", "definitely not a url"],
  ])("refuses a %s referrer", (_label, referer) => {
    // This string is rendered on the subscriber evidence screen. A scheme that
    // can execute has no business reaching it.
    expect(consentSourceFrom({ origin: null, referer })).toBeNull();
  });

  it("bounds the stored length", () => {
    const long = "https://example.com/" + "a".repeat(CONSENT_SOURCE_MAX * 2);
    const result = consentSourceFrom({ origin: null, referer: long });
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(CONSENT_SOURCE_MAX);
  });
});

describe("hosted URLs", () => {
  it("escapes the key rather than interpolating it raw", () => {
    expect(hostedSignupUrl("https://postbox.help", "a/b?c")).toBe(
      "https://postbox.help/s/a%2Fb%3Fc",
    );
  });

  it("does not double the slash when the app URL has a trailing one", () => {
    expect(hostedSignupUrl("https://postbox.help/", "cli_abc")).toBe(
      "https://postbox.help/s/cli_abc",
    );
    expect(confirmUrl("https://postbox.help/", "tok")).toBe(
      "https://postbox.help/s/confirm?t=tok",
    );
  });
});
