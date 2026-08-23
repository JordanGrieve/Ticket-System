import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { assertDatabaseIsSafe } from "./guard";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add your Neon Postgres connection string to .env.local (see .env.example).",
  );
}

/**
 * Refuse to connect to an undeclared database from a developer's machine.
 *
 * On Vercel this is a no-op — production is what should be connected there.
 * Locally it demands that .env.local say which database it points at, because
 * until now it silently pointed at production and every dev server, seed
 * script and ad-hoc query ran against a live client's customer records.
 *
 * Throwing HERE rather than in each script is deliberate: this module is the
 * single chokepoint every query passes through, so there is no path that
 * forgets to ask. See ./guard.ts.
 */
assertDatabaseIsSafe({
  vercel: process.env.VERCEL,
  vercelEnv: process.env.VERCEL_ENV,
  databaseEnv: process.env.DATABASE_ENV,
  allowProduction: process.env.ALLOW_PRODUCTION_DB,
  databaseUrl: connectionString,
});

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });

export { schema };
