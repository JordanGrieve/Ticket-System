import { describe, it, expect } from "vitest";
import { highlight, type Token } from "../lib/highlight";

/**
 * The install page's code colouring.
 *
 * ── THE ONE THAT MATTERS ──
 * Round-tripping. Everything else here is cosmetic — a mis-coloured bracket is
 * a mis-coloured bracket — but a tokeniser that DROPS a character renders a
 * prompt that differs from the one the copy button hands over, and the block
 * is the only place a client can see what they are giving their developer. A
 * missing line in a rendered instruction is invisible and wrong.
 */

const PROMPT = `You are helping integrate a website's contact form with Postbox, a support-ticket
inbox used by "AMORIA". When a visitor submits the contact form, the
submission must be POSTed to the Postbox API, which turns it into a support ticket.

## The API
Endpoint: POST https://postbox.help/api/tickets/cli_1431e29d5fe86b2ddb9c0ded0fa41d94
Accepts JSON (Content-Type: application/json) or classic form-encoded submissions.

Fields:
- name    (string, required)  — the visitor's name
- email   (string, required)  — the visitor's email address

Responses:
- Success:            HTTP 201, JSON {"ok": true, "ticket": {"id": 123, "status": "open"}}
- Rate limited:       HTTP 429 (60 submissions/minute per workspace) — treat as a
  temporary failure and ask the visitor to try again shortly.`;

const HTML = `<form action="https://postbox.help/api/tickets/cli_x" method="POST">
  <input name="name" placeholder="Your name" required />
  <textarea name="message" placeholder="How can we help?"></textarea>
  <button type="submit">Send</button>
</form>`;

const join = (tokens: Token[]) => tokens.map((t) => t.text).join("");
const kindsOf = (tokens: Token[], text: string) =>
  tokens.filter((t) => t.text === text).map((t) => t.kind);
const textsOf = (tokens: Token[], kind: string) =>
  tokens.filter((t) => t.kind === kind).map((t) => t.text);

describe("nothing is lost", () => {
  it("puts the prompt back together character for character", () => {
    expect(join(highlight(PROMPT, "prompt"))).toBe(PROMPT);
  });

  it("puts the HTML back together character for character", () => {
    expect(join(highlight(HTML, "html"))).toBe(HTML);
  });

  it("keeps every blank line", () => {
    // Blank lines are structure in a prompt — they separate the sections an
    // assistant reads as separate instructions. A `.filter(Boolean)` over the
    // lines would swallow them and nothing else here would notice.
    const code = "a\n\n\nb";
    expect(join(highlight(code, "prompt"))).toBe(code);
    expect(join(highlight(code, "html"))).toBe(code);
  });

  it("emits no empty tokens", () => {
    // An empty span is a DOM node that renders nothing — harmless, but it means
    // the scanner advanced zero characters somewhere, which is one step from a
    // loop that does not terminate.
    for (const lang of ["prompt", "html"] as const) {
      const empties = highlight(lang === "html" ? HTML : PROMPT, lang).filter(
        (t) => t.text === "",
      );
      expect(empties).toEqual([]);
    }
  });

  it("leaves plain alone entirely", () => {
    expect(highlight(PROMPT, "plain")).toEqual([{ text: PROMPT, kind: "plain" }]);
  });
});

describe("the prompt grammar", () => {
  const tokens = highlight(PROMPT, "prompt");

  it("colours a heading end to end", () => {
    expect(textsOf(tokens, "head")).toEqual(["## The API"]);
  });

  it("keeps a URL in one piece", () => {
    /*
     * The reason the scanner takes the earliest match rather than applying
     * rules in sequence. A URL is full of digits and colons; a number rule run
     * over text that has not been claimed yet chops it into a dozen tokens and
     * paints the digits of somebody's API key a different colour from the rest
     * of it.
     */
    expect(textsOf(tokens, "url")).toEqual([
      "https://postbox.help/api/tickets/cli_1431e29d5fe86b2ddb9c0ded0fa41d94",
    ]);
  });

  it("reads the workspace name as a string, quotes and all", () => {
    expect(textsOf(tokens, "str")).toContain('"AMORIA"');
  });

  it("names the field on a bullet line and greys its explanation", () => {
    expect(textsOf(tokens, "attr")).toEqual(
      expect.arrayContaining(["name", "email", "Success:", "Rate"]),
    );
    const comments = textsOf(tokens, "comment");
    expect(comments.some((c) => c.includes("the visitor's name"))).toBe(true);
  });

  it("does not grey the back half of ordinary prose", () => {
    /*
     * The em-dash-is-a-comment rule is scoped to bullet lines on purpose. This
     * line is prose with an em dash in it; if the rule were global, the
     * document would come out half-dimmed.
     */
    const prose = highlight(
      "Accepts JSON — or classic form-encoded submissions.",
      "prompt",
    );
    expect(textsOf(prose, "comment")).toEqual([]);
  });

  it("knows the verbs the document is about", () => {
    expect(textsOf(tokens, "key")).toEqual(
      expect.arrayContaining(["POST", "HTTP", "JSON", "Content-Type", "true"]),
    );
  });

  it("does not paint a word that merely contains one", () => {
    // "POSTed" is prose. A rule without word boundaries colours the POST in it
    // and leaves "ed" behind in the body colour, which looks like a rendering
    // fault rather than a highlight.
    expect(textsOf(tokens, "key")).not.toContain("POSTed");
    // And it stays inside a plain run rather than being split across two
    // tokens, which is what a boundary-less rule would do to it.
    expect(
      textsOf(tokens, "plain").some((t) => t.includes("POSTed")),
    ).toBe(true);
  });
});

describe("the HTML grammar", () => {
  const tokens = highlight(HTML, "html");

  it("colours tag names with their bracket", () => {
    expect(textsOf(tokens, "tag")).toEqual(
      expect.arrayContaining(["<form", "<input", "<textarea", "</textarea", "</form"]),
    );
  });

  it("colours attribute names, and leaves the equals as punctuation", () => {
    expect(textsOf(tokens, "attr")).toEqual(
      expect.arrayContaining(["action", "method", "name", "placeholder", "type"]),
    );
    expect(kindsOf(tokens, "=")).not.toContain("attr");
  });

  it("colours attribute values as strings", () => {
    expect(textsOf(tokens, "str")).toEqual(
      expect.arrayContaining(['"submit"', '"Your name"', '"How can we help?"']),
    );
  });

  it("does not mistake a URL inside an attribute for markup", () => {
    // `//` inside https:// is punctuation to the naive rule and the string rule
    // has to win. If this breaks, an endpoint renders in three colours.
    expect(textsOf(tokens, "str")).toContain(
      '"https://postbox.help/api/tickets/cli_x"',
    );
  });
});
