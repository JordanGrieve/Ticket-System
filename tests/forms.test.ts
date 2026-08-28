import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newFormKey } from "../lib/forms";

/**
 * Named contact forms.
 *
 * lib/forms.ts is server-only and talks to the database, so the properties
 * that can be checked without one are checked here: the shape of a key, and —
 * by reading the source — the tenancy and revocation rules that a regression
 * would otherwise only reveal in production, on somebody else's data.
 */

const SRC = readFileSync(join(process.cwd(), "lib/forms.ts"), "utf8");
const INGEST = readFileSync(
  join(process.cwd(), "app/api/tickets/[id]/route.ts"),
  "utf8",
);

describe("the key a form posts with", () => {
  it("is long enough that guessing is not a strategy", () => {
    // 18 random bytes as hex. The endpoint is public and unauthenticated
    // beyond this string, so its entropy IS the access control.
    const key = newFormKey();
    expect(key.length).toBeGreaterThanOrEqual(36);
  });

  it("is unique across calls", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newFormKey()));
    expect(keys.size).toBe(200);
  });

  it("is marked as a form key", () => {
    // Only so it is legible in a log or a support conversation. It is not a
    // security boundary — the prefix is public like the rest of it.
    expect(newFormKey().startsWith("pbf_")).toBe(true);
  });

  it("is URL-safe, because it is a path segment", () => {
    // It arrives as /api/tickets/<key>. A character needing encoding would
    // work from our own snippet and break the moment somebody typed it.
    expect(newFormKey()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("every mutation is scoped to the workspace", () => {
  /*
   * A form id arrives from a request. The predicate has to be part of the
   * mutating statement, not a check performed first that a concurrent request
   * could invalidate — the same rule the trash and label stores follow, and
   * the one tests/tenancy-invariants.test.ts exists to enforce for raw SQL.
   * These are query-builder writes, which that sweep only started covering
   * this week, so they are pinned here too.
   */
  for (const fn of ["renameForm", "revokeFormKey", "regenerateFormKey"]) {
    it(`${fn} filters on workspaceId inside the statement`, () => {
      const start = SRC.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = SRC.slice(start, start + 900);
      expect(body).toMatch(/eq\(forms\.workspaceId, input\.workspaceId\)/);
      expect(body).toMatch(/eq\(forms\.id, input\.formId\)/);
    });
  }
});

describe("revoking a key does not rewrite history", () => {
  it("clears the key rather than deleting the form", () => {
    /*
     * forms.id is referenced by tickets.form_id ON DELETE SET NULL, so
     * deleting a form would quietly blank the provenance of every ticket that
     * ever came through it — a year of "where did this enquiry come from?"
     * turning into null. Clearing the key stops new submissions and leaves the
     * history alone.
     */
    expect(SRC).toMatch(/set\(\{ key: null \}\)/);
    expect(SRC).not.toMatch(/\.delete\(forms\)/);
  });
});

describe("the workspace key keeps working", () => {
  it("is tried before any form key", () => {
    // Every installation in existence posts with the workspace key, including
    // the bakery's — whose form 401'd for six weeks earlier this month. A
    // change here that broke it would repeat exactly that failure.
    const wsLookup = SRC.indexOf("eq(workspaces.apiKey, key)");
    const formLookup = SRC.indexOf("eq(forms.key, key)");
    expect(wsLookup).toBeGreaterThan(-1);
    expect(formLookup).toBeGreaterThan(wsLookup);
  });

  it("resolves to a null form, not to a refusal", () => {
    expect(SRC).toMatch(/return \{ workspace: ws, form: null \}/);
  });
});

describe("ingest records which form a ticket came through", () => {
  it("stores the form id on the ticket", () => {
    expect(INGEST).toMatch(/formId: target\.form\?\.id \?\? null/);
  });

  it("still records an unknown key as an ingestion failure", () => {
    // The bakery's form failed silently for six weeks because this branch
    // discarded the fact. Resolving two kinds of key must not lose it.
    const start = INGEST.indexOf("if (!target || !workspace)");
    expect(start).toBeGreaterThan(-1);
    expect(INGEST.slice(start, start + 400)).toMatch(/recordIngestionFailure/);
  });
});

describe("a stale FORM key is not silently discarded", () => {
  /*
   * lib/ingestion-log.ts only records failures for keys shaped like ones this
   * product issues, so that internet scanning cannot flood the table. When
   * form keys were added that filter still only matched cli_, which meant a
   * stale pbf_ key — the exact bakery scenario, for the new key type — would
   * have been dropped without a trace.
   *
   * Found by posting a junk pbf_ key at the running endpoint and seeing
   * ingestion_failures stay empty. Any future prefix must be added there too.
   */
  const LOG = readFileSync(join(process.cwd(), "lib/ingestion-log.ts"), "utf8");

  it("the failure log recognises the form key prefix", () => {
    const m = LOG.match(/const KEY_SHAPE = (\/.+\/);/);
    expect(m).not.toBeNull();
    const shape: RegExp = eval(m![1]);
    expect(shape.test(newFormKey())).toBe(true);
  });

  it("still recognises a workspace key", () => {
    const m = LOG.match(/const KEY_SHAPE = (\/.+\/);/);
    const shape: RegExp = eval(m![1]);
    expect(shape.test("cli_demo_devbusiness")).toBe(true);
  });

  it("still refuses junk, so scanning cannot flood the table", () => {
    const m = LOG.match(/const KEY_SHAPE = (\/.+\/);/);
    const shape: RegExp = eval(m![1]);
    expect(shape.test("../../etc/passwd")).toBe(false);
    expect(shape.test("random-scanner-string")).toBe(false);
  });
});
