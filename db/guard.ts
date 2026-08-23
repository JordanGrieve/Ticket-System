/**
 * Refuse to touch the production database from a developer's machine.
 *
 * ── WHY ──
 * There has never been a development database. `.env.local` holds the
 * production connection string, so `next dev`, every `tsx db/*.ts` script and
 * every ad-hoc diagnostic has been running against a live client's customer
 * records — names, email addresses, support conversations. Nothing sat between
 * a mistyped WHERE clause and a real business's data.
 *
 * It has been fine so far, which is not the same as being safe. "Careful" is a
 * habit; this is a control.
 *
 * ── THE RULE ──
 * On Vercel, the production database is exactly what should be connected —
 * allowed unconditionally.
 *
 * Anywhere else, the connection must be declared: either it is a development
 * database (`DATABASE_ENV=development`) or the developer has deliberately
 * opted in for one command (`ALLOW_PRODUCTION_DB=1`). Silence is refused,
 * because silence is the state that produced the problem.
 *
 * ── WHY DECLARATION, NOT DETECTION ──
 * Guessing from the URL — hostname patterns, a "dev" substring, a branch id —
 * would be a guard that fails open on the case it exists for: a production
 * URL that happens not to match the pattern is waved through, silently. A
 * developer stating which database they are pointing at cannot fail that way.
 * The cost is one line in .env.local, once.
 *
 * Pure and injectable so the refusal itself is testable — a guard nobody can
 * test is a guard nobody can trust.
 */

export type GuardEnv = {
  /** "1" on Vercel (build and runtime). Absent locally. */
  vercel?: string;
  /**
   * "production" | "preview" | "development" on Vercel. Checked as well as
   * `vercel` on purpose: this guard runs during `db:migrate` in the build, and
   * a guard that can break the deploy is worse than the problem it solves.
   * Two independent Vercel signals means one of them being absent or renamed
   * cannot take the site down. Neither is ever set on a laptop, so accepting
   * either costs nothing locally.
   */
  vercelEnv?: string;
  /** Set to "development" in a dev .env.local. */
  databaseEnv?: string;
  /** Explicit, deliberate opt-in for one command. */
  allowProduction?: string;
  /** Only used to say something useful in the error. Never parsed for intent. */
  databaseUrl?: string;
};

export type GuardResult =
  | { ok: true; reason: "vercel" | "declared-dev" | "explicit-override" }
  | { ok: false; message: string };

export function checkDatabaseSafety(env: GuardEnv): GuardResult {
  // Deployed. This is the production app; connecting to production is correct.
  if (env.vercel === "1" || (env.vercelEnv ?? "").trim() !== "") {
    return { ok: true, reason: "vercel" };
  }

  if ((env.databaseEnv ?? "").trim().toLowerCase() === "development") {
    return { ok: true, reason: "declared-dev" };
  }

  if ((env.allowProduction ?? "").trim() === "1") {
    return { ok: true, reason: "explicit-override" };
  }

  return {
    ok: false,
    message: [
      "Refusing to connect: this database is not declared as a development one.",
      "",
      `  DATABASE_URL  ${describe(env.databaseUrl)}`,
      "",
      "There is no dev database yet, so .env.local most likely still points at",
      "PRODUCTION — a live client's customer records.",
      "",
      "Pick one:",
      "",
      "  1. Create a Neon branch and use its connection string (recommended).",
      "     Neon → your project → Branches → New branch from main. It is a",
      "     copy-on-write clone: instant, and included on the free plan.",
      "     Then add to .env.local:",
      "         DATABASE_URL=<the branch connection string>",
      "         DATABASE_ENV=development",
      "",
      "  2. Deliberately use production for ONE command:",
      "         ALLOW_PRODUCTION_DB=1 npm run <script>",
      "",
      "See docs/DEV-DATABASE.md.",
    ].join("\n"),
  };
}

/**
 * Host and database name only. The connection string carries a password, and
 * this string ends up in terminals, CI logs and screenshots — the whole point
 * of the message is to be pasted somewhere while asking for help.
 */
function describe(url: string | undefined): string {
  if (!url) return "(not set)";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

/** Throws with the guidance above unless this connection is allowed. */
export function assertDatabaseIsSafe(env: GuardEnv): void {
  const result = checkDatabaseSafety(env);
  if (!result.ok) throw new Error(result.message);
}

/**
 * drizzle-kit subcommands that never open a connection.
 *
 * `generate` diffs schema.ts against the existing migration files and writes
 * SQL; `check` and `up` only read and rewrite migration metadata. None of them
 * touch a database, so guarding them is a false positive — and a false
 * positive here is worse than none at all, because it teaches you to type
 * ALLOW_PRODUCTION_DB=1 for harmless commands until it stops meaning anything.
 *
 * Everything not listed connects: migrate, push, studio, pull/introspect. The
 * default is therefore GUARDED, so a subcommand added by a future drizzle-kit
 * version is protected until somebody deliberately decides otherwise.
 */
const OFFLINE_DRIZZLE_COMMANDS = ["generate", "check", "up"];

export function commandTouchesDatabase(argv: readonly string[]): boolean {
  return !argv.some((arg) => OFFLINE_DRIZZLE_COMMANDS.includes(arg));
}

/** Guard, unless this invocation is a drizzle-kit command that stays offline. */
export function assertDatabaseIsSafeForCommand(
  env: GuardEnv,
  argv: readonly string[],
): void {
  if (!commandTouchesDatabase(argv)) return;
  assertDatabaseIsSafe(env);
}
