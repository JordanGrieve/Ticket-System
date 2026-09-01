import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A 429 on a public endpoint is now recorded.
 *
 * ── WHY THIS ONE MATTERS MORE THAN THE OTHER REJECTIONS ──
 * ingestion_failures already recorded invalid_key, missing_fields,
 * invalid_email and honeypot. Every one of those means the caller sent
 * something wrong.
 *
 * A rate-limit rejection is the opposite: the caller may have sent something
 * perfectly good and we turned it away. A client whose form is being hammered,
 * or retried by a broken script, has real enquiries bouncing off a 429 while
 * the sender reads "try again shortly" — and unlogged, that is invisible from
 * both ends. The client sees no enquiry and no error; the console shows
 * nothing. It is the bakery failure with a different cause.
 *
 * ── WHAT WAS ALREADY FINE, CHECKED BEFORE BUILDING ──
 * PIVOT 33 listed "public API-key ingestion traffic" as unlogged, which read
 * as a much bigger gap than it is. A SUCCESSFUL ingestion writes a ticket
 * carrying its source, form id, customer email and timestamp — the ticket IS
 * the record, and a second log of it would be duplication. The genuinely
 * unlogged slice was the 429 path, on both public endpoints.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const ROUTES: [string, string][] = [
  ["tickets", read("app", "api", "tickets", "[id]", "route.ts")],
  ["subscribe", read("app", "api", "subscribe", "[key]", "route.ts")],
];

describe.each(ROUTES)("%s: the 429 path is recorded", (name, src) => {
  /** Source with comments stripped, so prose cannot satisfy an assertion. */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("records a rate_limited failure", () => {
    expect(code).toContain('reason: "rate_limited"');
  });

  it("records BEFORE returning the 429, not after", () => {
    // Ordering is the whole thing: a record written after the return never
    // runs. Anchored on the call, not the import — matching the import line is
    // a mistake this repo has already made twice.
    const record = code.indexOf('reason: "rate_limited"');
    const after = code.slice(record);
    expect(after).toMatch(/status:\s*429/);
  });

  it("names the workspace, since the key already resolved", () => {
    /*
      The key was validated further up, so we know WHOSE form is being
      throttled. Without it the console could only say that something was
      being turned away, which is the difference between a diagnostic and a
      shrug.
    */
    const record = code.indexOf('reason: "rate_limited"');
    const block = code.slice(record, record + 220);
    expect(block).toMatch(/workspaceId:\s*workspace\.id/);
  });
});

describe("the console can name every rejection reason", () => {
  const sections = read("app", "(admin)", "admin", "sections.tsx");
  const schema = read("db", "schema.ts");

  it("labels rate_limited as a problem, not as machinery working", () => {
    // "Rate limited" describes our defence. This row may mean a real enquiry
    // was lost, so it should read as something to look at.
    expect(sections).toMatch(/rate_limited:\s*"Turned away/);
  });

  it("types the label map by the union, so a new reason cannot go unlabelled", () => {
    /*
      It was Record<string, string>, which meant adding a reason to the schema
      compiled cleanly and rendered the raw enum value to an operator. Typed by
      IngestionFailureReason, the build fails until somebody gives it words —
      the same discipline describeAdminAction gets from an exhaustive switch.
    */
    expect(sections).toContain(
      "const REJECTION_LABELS: Record<IngestionFailureReason, string>",
    );
  });

  it("has a label for every reason the schema declares", () => {
    // Belt and braces over the typing above: this fails loudly with the
    // missing name rather than as a type error somebody might suppress.
    const union = /export type IngestionFailureReason =([\s\S]*?);/.exec(schema)?.[1] ?? "";
    const reasons = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(reasons.length, "could not read the reason union").toBeGreaterThan(3);

    const labelBlock =
      /const REJECTION_LABELS[\s\S]*?\{([\s\S]*?)\n\};/.exec(sections)?.[1] ?? "";
    const missing = reasons.filter((r) => !new RegExp(`\\b${r}:`).test(labelBlock));
    expect(missing, "reasons with no operator-facing label").toEqual([]);
  });
});
