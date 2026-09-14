/**
 * Syntax colouring for the two things the Install page shows a client.
 *
 * ── WHY NOT A LIBRARY ──
 * Shiki and highlight.js are 200kB-plus of grammars and themes to colour two
 * fixed strings this product generates itself. Both would also arrive with
 * their own palettes, which is the part that actually matters here: every ink
 * on this page is measured at 7:1 against the ground it is painted on
 * (WCAG 1.4.6, AAA — see STYLE-GUIDE.md §1), and no shipped editor theme is
 * built to that bar. VS Code's Dark+ comment green is 4.2:1 on its own
 * background.
 *
 * So this returns KINDS, not colours. The stylesheet names the inks, the token
 * guard measures them, and the two themes get different values for the same
 * kind — which is the other half of what was asked for: a light code block in
 * the light theme, not one dark panel in both.
 *
 * ── WHAT IT DOES NOT DO ──
 * It is not a parser. It cannot tell a `#` heading from a `#` inside a string
 * that spans lines, because nothing here spans lines. It colours the two
 * inputs in components/InstallView.tsx and is tested against those exact
 * strings; anything else gets a best effort and, at worst, plain text. Colour
 * carries no meaning on this page — the prompt is copied, not read — so a
 * missed token is a cosmetic miss, never a lost instruction (1.4.1).
 */

/** The ink a run of text is painted in. `plain` is the block's body colour. */
export type TokenKind =
  | "plain"
  | "head"
  | "comment"
  | "str"
  | "num"
  | "url"
  | "key"
  | "tag"
  | "attr"
  | "punct";

export type Token = { text: string; kind: TokenKind };

/** The grammars available. `plain` returns the input untouched, in one token. */
export type Language = "prompt" | "html" | "plain";

type Rule = { kind: TokenKind; re: RegExp };

/*
  Ordering inside a rule list does NOT decide precedence — the scanner takes
  whichever rule matches EARLIEST in the remaining text, and only uses list
  order to break a tie at the same position. That is what keeps a URL's colons
  and digits inside the URL: the url rule starts before the punct rule can
  match the "://" in it.
*/

const PROMPT_RULES: Rule[] = [
  // Quoted text first at a tie, so the workspace name in "AMORIA" and the JSON
  // keys in the example responses read as strings rather than as punctuation
  // around bare words.
  { kind: "str", re: /"[^"\n]*"/g },
  { kind: "url", re: /https?:\/\/[^\s)]+/g },
  // The vocabulary this document is actually about. Bounded, because a general
  // "capitalised word" rule would paint every sentence's first word.
  {
    kind: "key",
    re: /\b(?:POST|GET|PUT|PATCH|DELETE|HTTP|JSON|CORS|Content-Type|Endpoint|Fields|Responses|true|false|null|required|optional)\b/g,
  },
  { kind: "num", re: /\b\d+(?:\.\d+)?\b/g },
  { kind: "punct", re: /[{}[\]():,]/g },
];

const HTML_RULES: Rule[] = [
  { kind: "comment", re: /<!--[\s\S]*?-->/g },
  { kind: "str", re: /"[^"\n]*"/g },
  // The tag name travels with its bracket, so `<form` is one run and the
  // closing `>` is punctuation on its own.
  { kind: "tag", re: /<\/?[a-zA-Z][\w-]*/g },
  // An attribute is a name with an `=` after it. Lookahead, so the `=` itself
  // stays punctuation and the name does not swallow it.
  { kind: "attr", re: /[a-zA-Z-]+(?==)/g },
  { kind: "punct", re: /[<>/=]/g },
];

/**
 * Walk `text` once, emitting a token for every match and for the plain runs
 * between them.
 *
 * The earliest-match-wins loop is the whole algorithm. A rule list applied in
 * sequence — colour all the strings, then all the numbers — is the version
 * that looks simpler and is wrong: it finds the digits INSIDE a URL and inside
 * a string, because by then it is looking at text that has already been
 * claimed.
 */
function scan(text: string, rules: Rule[]): Token[] {
  const out: Token[] = [];
  let at = 0;

  while (at < text.length) {
    let best: { index: number; text: string; kind: TokenKind } | null = null;

    for (const rule of rules) {
      rule.re.lastIndex = at;
      const m = rule.re.exec(text);
      if (!m) continue;
      // Strictly earlier, so a tie goes to the rule listed first.
      if (!best || m.index < best.index) {
        best = { index: m.index, text: m[0], kind: rule.kind };
      }
    }

    if (!best) break;
    if (best.index > at) out.push({ text: text.slice(at, best.index), kind: "plain" });
    out.push({ text: best.text, kind: best.kind });
    at = best.index + best.text.length;
  }

  if (at < text.length) out.push({ text: text.slice(at), kind: "plain" });
  return out;
}

/**
 * One line of the prompt grammar.
 *
 * Three shapes get special handling before the inline rules run, because each
 * is a whole-line decision that no inline rule could make:
 *
 * - `## The API` — a heading, coloured end to end.
 * - `- name  (string, required)  — the visitor's name` — a field. The name
 *   after the bullet is the subject of the line and reads as one; everything
 *   after the em dash is the explanation, and greys out like a comment.
 * - Everything else — prose, scanned inline.
 *
 * The em-dash-is-a-comment rule is deliberately limited to bullet lines. Prose
 * here uses em dashes too ("Rate limited: HTTP 429 — treat as a temporary
 * failure"), and greying the back half of ordinary sentences would dim most of
 * the document for no reason.
 */
function promptLine(line: string): Token[] {
  if (/^\s*#{1,6}\s/.test(line)) return [{ text: line, kind: "head" }];

  const bullet = /^(\s*[-*]\s+)(\S+)([\s\S]*)$/.exec(line);
  if (!bullet) return scan(line, PROMPT_RULES);

  const [, mark, field, rest] = bullet as unknown as [string, string, string, string];
  const dash = rest.indexOf("—");
  const head = dash === -1 ? rest : rest.slice(0, dash);
  const tail = dash === -1 ? "" : rest.slice(dash);

  return [
    { text: mark, kind: "punct" },
    { text: field, kind: "attr" },
    ...scan(head, PROMPT_RULES),
    ...(tail ? [{ text: tail, kind: "comment" as const }] : []),
  ];
}

/**
 * Tokenise `code` for `language`.
 *
 * Newlines are preserved as their own plain tokens, so joining every token's
 * text back together reproduces the input exactly — which is asserted in
 * tests/highlight.test.ts. Nothing here may drop, reorder or alter a
 * character: the copy button reads the original string, so a block that
 * rendered different text from the one it copies would be lying about what the
 * client is handing their developer.
 */
export function highlight(code: string, language: Language): Token[] {
  if (language === "plain") return [{ text: code, kind: "plain" }];

  const lines = code.split("\n");
  const out: Token[] = [];

  lines.forEach((line, i) => {
    if (i > 0) out.push({ text: "\n", kind: "plain" });
    if (line === "") return;
    out.push(...(language === "prompt" ? promptLine(line) : scan(line, HTML_RULES)));
  });

  return out;
}
