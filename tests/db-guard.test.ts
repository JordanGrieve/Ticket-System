import { describe, it, expect } from "vitest";
import { checkDatabaseSafety, type GuardEnv } from "../db/guard";

/**
 * A guard nobody can test is a guard nobody can trust — and this one's whole
 * job is to fail CLOSED. The tests that matter are the ones proving it refuses,
 * because a guard that quietly waves everything through looks identical to a
 * working one right up until the moment it matters.
 */

const PROD_URL =
  "postgresql://user:secret@ep-cool-glade-12345.eu-central-1.aws.neon.tech/neondb?sslmode=require";

const env = (over: Partial<GuardEnv> = {}): GuardEnv => ({
  databaseUrl: PROD_URL,
  ...over,
});

describe("refusing by default", () => {
  it("refuses an undeclared database", () => {
    // The state that produced the problem: .env.local with a production URL
    // and nothing saying so. Silence must not be permission.
    const r = checkDatabaseSafety(env());
    expect(r.ok).toBe(false);
  });

  it("refuses even when DATABASE_URL is unset", () => {
    // A missing URL is not a safe one — db/index.ts has its own error for
    // that, and this guard must not accidentally authorise the empty case.
    expect(checkDatabaseSafety({ databaseUrl: undefined }).ok).toBe(false);
  });

  it.each([
    ["production", "production"],
    ["prod", "prod"],
    ["dev-ish but wrong", "develop"],
    ["empty", ""],
    ["whitespace", "   "],
  ])("refuses DATABASE_ENV=%s", (_label, databaseEnv) => {
    expect(checkDatabaseSafety(env({ databaseEnv })).ok).toBe(false);
  });

  it("refuses a truthy-looking but non-'1' override", () => {
    // "true"/"yes" would be a plausible thing to type and must not work, or
    // the override becomes ambient rather than deliberate.
    expect(checkDatabaseSafety(env({ allowProduction: "true" })).ok).toBe(false);
    expect(checkDatabaseSafety(env({ allowProduction: "yes" })).ok).toBe(false);
    expect(checkDatabaseSafety(env({ allowProduction: "0" })).ok).toBe(false);
  });
});

describe("allowing deliberately", () => {
  it("allows on Vercel, where production IS the right database", () => {
    const r = checkDatabaseSafety(env({ vercel: "1" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe("vercel");
  });

  it("allows when only VERCEL_ENV is set, not VERCEL", () => {
    // Two independent deploy signals on purpose: this guard runs during
    // db:migrate in the Vercel build, and a guard that can break the deploy is
    // worse than the problem it solves. Neither var is ever set on a laptop.
    const r = checkDatabaseSafety(env({ vercelEnv: "production" }));
    expect(r.ok).toBe(true);
  });

  it("is not fooled by an empty VERCEL_ENV", () => {
    expect(checkDatabaseSafety(env({ vercelEnv: "" })).ok).toBe(false);
    expect(checkDatabaseSafety(env({ vercelEnv: "  " })).ok).toBe(false);
  });

  it("allows a declared development database", () => {
    const r = checkDatabaseSafety(env({ databaseEnv: "development" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe("declared-dev");
  });

  it("is case- and whitespace-tolerant on the declaration", () => {
    expect(checkDatabaseSafety(env({ databaseEnv: " Development " })).ok).toBe(
      true,
    );
  });

  it("allows an explicit one-command override", () => {
    const r = checkDatabaseSafety(env({ allowProduction: "1" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe("explicit-override");
  });
});

describe("the refusal message", () => {
  const message = () => {
    const r = checkDatabaseSafety(env());
    return r.ok ? "" : r.message;
  };

  it("never prints the password", () => {
    // This message exists to be pasted into a terminal, a CI log, or a
    // screenshot attached to a question. A connection string carries
    // credentials; host and database name are enough to identify it.
    expect(message()).not.toContain("secret");
    expect(message()).not.toContain(PROD_URL);
  });

  it("still identifies WHICH database was refused", () => {
    // Refusing without saying what was refused makes the guard feel broken
    // rather than protective.
    expect(message()).toContain("ep-cool-glade-12345");
    expect(message()).toContain("/neondb");
  });

  it("says how to fix it, both ways", () => {
    const m = message();
    expect(m).toMatch(/DATABASE_ENV=development/);
    expect(m).toMatch(/ALLOW_PRODUCTION_DB=1/);
    expect(m).toMatch(/branch/i);
  });

  it("handles an unparseable URL without throwing", () => {
    const r = checkDatabaseSafety({ databaseUrl: "not a url at all" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("unparseable");
  });
});
