import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  DEFAULT_WELCOME_BODY,
  DEFAULT_WELCOME_SUBJECT,
  decodeWelcomeUnsubToken,
  encodeWelcomeUnsubToken,
  renderWelcome,
  WELCOME_TOKEN_PREFIX,
} from "../lib/welcome";
import { NO_BRAND } from "../lib/newsletter";

/**
 * The welcome email's decisions, without a database or a provider.
 *
 * The token half matters most: it is the only thing standing between a
 * stranger and unsubscribing somebody else's customers, and unlike the
 * campaign token it is not looked up in a table — the signature IS the
 * authorisation.
 */

const SECRET = "a-test-signing-secret-long-enough";

const SENDER = {
  workspaceName: "Open Door Bakery",
  legalName: "Open Door Bakery Ltd",
  postalAddress: "12 High Street\nHarrogate\nHG1 1AA",
};

describe("the unsubscribe token", () => {
  it("round-trips the workspace and the address", () => {
    const t = encodeWelcomeUnsubToken(7, "alex@example.com", SECRET);
    expect(decodeWelcomeUnsubToken(t, SECRET)).toEqual({
      ok: true,
      workspaceId: 7,
      email: "alex@example.com",
    });
  });

  it("normalises the address on the way in", () => {
    // unsubscribeByToken matches on lower(btrim(...)); a token carrying
    // "  Alex@Example.COM " must stop the same mailbox as one carrying the
    // normalised form, or the link in the email fails for its own recipient.
    const t = encodeWelcomeUnsubToken(7, "  Alex@Example.COM ", SECRET);
    const got = decodeWelcomeUnsubToken(t, SECRET);
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("unreachable");
    expect(got.email).toBe("alex@example.com");
  });

  it("refuses a token signed with a different secret", () => {
    const t = encodeWelcomeUnsubToken(7, "alex@example.com", SECRET);
    expect(decodeWelcomeUnsubToken(t, "a-completely-different-secret!!")).toEqual({
      ok: false,
    });
  });

  it("refuses a tampered payload", () => {
    // The attack the signature exists to stop: re-point a valid link at
    // another workspace, or at somebody else's address.
    const t = encodeWelcomeUnsubToken(7, "alex@example.com", SECRET);
    const forged =
      WELCOME_TOKEN_PREFIX +
      Buffer.from(JSON.stringify({ w: 8, e: "victim@example.com" }))
        .toString("base64url") +
      "." +
      t.split(".").pop();
    expect(decodeWelcomeUnsubToken(forged, SECRET)).toEqual({ ok: false });
  });

  it("refuses a confirmation token, and anything else shaped wrong", () => {
    // Domain separation: lib/subscribe.ts signs with a different constant, so
    // a signature minted to CONFIRM a subscription cannot cancel one.
    for (const bad of [
      "",
      "nonsense",
      "w1.",
      "w1.onlyonepart",
      "c1.abc.def",
      encodeWelcomeUnsubToken(7, "alex@example.com", SECRET).slice(3),
    ]) {
      expect(decodeWelcomeUnsubToken(bad, SECRET), bad).toEqual({ ok: false });
    }
  });

  it("refuses a correctly signed payload that says nothing useful", () => {
    // The signature passes here — these tokens are minted with the real key
    // and the real domain — so the SHAPE CHECK is the only thing refusing
    // them. Without it a zero workspace id or an empty address would reach
    // the unsubscribe SQL, which matches on both.
    //
    // The domain constant is repeated rather than imported because it is not
    // exported, and because changing it SHOULD break this test: it would
    // invalidate every unsubscribe link already sitting in a mailbox.
    const mint = (obj: unknown): string => {
      const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
      const sig = createHmac("sha256", SECRET)
        .update(`postbox.unsubscribe.welcome.v1.${payload}`)
        .digest("base64url");
      return `${WELCOME_TOKEN_PREFIX}${payload}.${sig}`;
    };

    // The control: a well-formed payload minted this way IS accepted, which
    // is what proves the rejections below are about the payload and not
    // about the signature.
    expect(decodeWelcomeUnsubToken(mint({ w: 3, e: "a@b.com" }), SECRET)).toEqual({
      ok: true,
      workspaceId: 3,
      email: "a@b.com",
    });

    for (const obj of [
      { w: 0, e: "a@b.com" },
      { w: -1, e: "a@b.com" },
      { w: 1.5, e: "a@b.com" },
      { w: 1, e: "" },
      { w: "1", e: "a@b.com" },
      {},
      null,
      "a string",
    ]) {
      expect(decodeWelcomeUnsubToken(mint(obj), SECRET), JSON.stringify(obj)).toEqual({
        ok: false,
      });
    }
  });
});

describe("rendering", () => {
  const base = {
    subject: DEFAULT_WELCOME_SUBJECT,
    body: DEFAULT_WELCOME_BODY,
    recipient: { email: "alex@example.com", name: "alex fenton" },
    workspaceName: "Open Door Bakery",
    unsubscribeUrl: "https://postbox.help/u/w1.abc.def",
    sender: SENDER,
    brand: NO_BRAND,
  };

  it("fills the merge tags", () => {
    const out = renderWelcome(base);
    expect(out.subject).toBe("Thanks for subscribing to Open Door Bakery");
    expect(out.text).toContain("Hi Alex");
    expect(out.text).not.toContain("{first_name}");
    expect(out.text).not.toContain("{company}");
  });

  it("carries the unsubscribe link and the postal address", () => {
    // Both are legal requirements and both are the renderer's job. This email
    // is triggered by the recipient, which does not make it transactional.
    const out = renderWelcome(base);
    expect(out.text).toContain("https://postbox.help/u/w1.abc.def");
    expect(out.text).toContain("12 High Street");
    expect(out.html).toContain("https://postbox.help/u/w1.abc.def");
  });

  it("refuses to render without a postal address", () => {
    // The same refusal a campaign gets. Inherited from renderCampaign rather
    // than re-implemented, so the two cannot drift apart.
    expect(() =>
      renderWelcome({
        ...base,
        sender: { ...SENDER, postalAddress: null },
      }),
    ).toThrow();
  });

  it("ships a default body with no placeholders to forget", () => {
    // The campaign starter body has [brackets] on purpose — it is written
    // before it is sent. This one sends unattended on the first signup, so
    // anything left unedited reaches a real customer.
    expect(DEFAULT_WELCOME_BODY).not.toMatch(/\[.+\]/);
  });

  it("never breaks a sentence mid-line", () => {
    /*
      The renderer makes a single newline a line break, so a body wrapped at
      78 characters for source readability reaches the reader wrapped at 78
      characters. The first real send did exactly that in Gmail, breaking
      after "at the bottom of".

      A hard wrap has a signature: a line that does not end a sentence,
      followed by one that continues it in lower case. The sign-off
      ("Thanks again," then "{company}") is a deliberate two-line block and is
      not caught, because the next line starts with a brace rather than a
      lower-case letter.
    */
    const lines = DEFAULT_WELCOME_BODY.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const here = lines[i]!;
      const next = lines[i + 1]!;
      if (!here.trim() || !next.trim()) continue;
      const continues = /^[a-z]/.test(next.trim());
      expect(continues, `line ${i + 1} wraps into the next: "${here}"`).toBe(false);
    }
  });
});
