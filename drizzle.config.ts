import "./db/env";
import { defineConfig } from "drizzle-kit";
import { assertDatabaseIsSafeForCommand } from "./db/guard";

/**
 * drizzle-kit does NOT import db/index.ts — it reads this file and connects on
 * its own. So the guard has to be repeated here, or `db:push` and `db:migrate`
 * would remain a way to reshape the production schema from a laptop while
 * every other path was protected. A guard with one unlocked door is decoration.
 *
 * `db:push` is the sharp one: it diffs the schema and applies the difference
 * directly, which on production means dropping columns to match whatever the
 * working tree happens to say.
 */
assertDatabaseIsSafeForCommand(
  {
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    databaseEnv: process.env.DATABASE_ENV,
    allowProduction: process.env.ALLOW_PRODUCTION_DB,
    databaseUrl: process.env.DATABASE_URL,
  },
  // "generate", "check" and "up" never open a connection, so they are not
  // guarded. Guarding them would be a false positive that teaches you to type
  // the production override for harmless commands. See db/guard.ts.
  process.argv,
);

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
