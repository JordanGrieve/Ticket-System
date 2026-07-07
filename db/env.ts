/**
 * Loads env vars for CLI scripts (seed, migrations). Next.js loads
 * .env.local automatically at runtime, so this is only imported by scripts.
 * Import this BEFORE ./index so DATABASE_URL is present when the pool builds.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config(); // fall back to .env
