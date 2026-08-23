/**
 * A stand-in for `@/db` in tests. Aliased in vitest.config.ts.
 *
 * ── WHY A STUB AND NOT A REAL CONNECTION ──
 * db/index.ts throws at import time when DATABASE_URL is unset, and it then
 * runs db/guard.ts to refuse an undeclared database. Both are correct — that
 * guard exists because local dev once silently pointed at a live client's
 * records — but between them they make every module that touches the database
 * unimportable in a suite that has no DATABASE_URL and should not want one.
 *
 * ── IT THROWS ON USE, DELIBERATELY ──
 * This is not a fake database and must never grow into one. Tests that reach a
 * real query have not been isolated; they have been given something that
 * quietly returns nothing, which is far worse than a failure because it looks
 * like a pass.
 *
 * So every property access explodes with a message naming the problem. A test
 * asserting that injected dependencies are used gets a genuine assertion out of
 * this: if the code under test ever bypasses its injected deps and reaches for
 * the real `db`, the test fails loudly instead of silently exercising nothing.
 */

const REACHED_REAL_DB =
  "A test reached the real `db`. Nothing in a unit test should: pass the " +
  "dependency in instead. If a module genuinely cannot be tested without a " +
  "database, it needs its IO injected — see AutoReplyDeps in " +
  "lib/auto-reply-send.ts for the pattern.";

export const db: never = new Proxy(
  {},
  {
    get() {
      throw new Error(REACHED_REAL_DB);
    },
    apply() {
      throw new Error(REACHED_REAL_DB);
    },
  },
) as never;

export const schema = new Proxy(
  {},
  {
    get() {
      throw new Error(REACHED_REAL_DB);
    },
  },
);
