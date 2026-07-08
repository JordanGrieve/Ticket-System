import "./env";
import { db } from "./index";
import { admins } from "./schema";

/**
 * Seeds the first super-admin(s). There has to be one before anyone can be
 * invited from the /admin screen. Idempotent — safe to re-run.
 *
 * Emails come from POSTBOX_BOOTSTRAP_ADMIN (comma-separated) or default to the
 * project owner. Local dev and production share the same Neon database, so
 * running this once grants admin in both places.
 *
 * Run: npm run db:bootstrap
 */
const raw = process.env.POSTBOX_BOOTSTRAP_ADMIN ?? "jordangrieve.dev@gmail.com";
const emails = raw
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function main() {
  for (const email of emails) {
    await db.insert(admins).values({ email }).onConflictDoNothing();
    console.log(`Bootstrapped super-admin: ${email}`);
  }
  console.log(`Done. ${emails.length} admin email(s) ensured.`);
}

main().then(() => process.exit(0));
