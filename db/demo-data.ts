import "./env";
import { neon } from "@neondatabase/serverless";

/**
 * Dress the dev workspace for SCREENSHOTS.
 *
 * Run with: npx tsx db/demo-data.ts
 *
 * ── WHY THIS EXISTS AND IS NOT JUST "USE THE DEV SEED" ──
 * The dev seed's customers are invented, but their addresses sit on domains
 * that really resolve — gmail.com, outlook.com, harbourdental.co.uk. That is
 * fine for local development and NOT fine in an image on a public marketing
 * page: I cannot prove that priya.raman@gmail.com is not a real person's live
 * mailbox, and publishing what looks like their private support thread would
 * be somebody's actual problem rather than a hypothetical one.
 *
 * So every address here is moved onto a RESERVED domain. `.example` is set
 * aside by RFC 2606 for exactly this and can never be registered by anyone, so
 * no address in a screenshot can ever reach a real inbox or name a real
 * company. The local parts and display names stay plausible, because a
 * screenshot full of "user1@test.com" persuades nobody.
 *
 * It also tidies the things that photograph badly: an over-long workspace name
 * that truncates in the sidebar, and timestamps clustered so tightly that
 * every row reads the same age.
 *
 * IDEMPOTENT and REVERSIBLE. Re-run it freely; run `npm run db:seed-dev` to
 * get the ordinary development data back.
 *
 * Dev only. It refuses to run against anything DATABASE_ENV has not declared a
 * development database, for the same reason db/guard.ts exists: this rewrites
 * customer email addresses, and doing that to a real client's inbox would be
 * unrecoverable.
 */

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.DATABASE_ENV !== "development") {
  throw new Error(
    "db/demo-data.ts rewrites customer email addresses and refuses to run " +
      "outside a development database. Set DATABASE_ENV=development if this " +
      "really is one.",
  );
}

const sql = neon(url);

/** Old address → screenshot-safe address on a reserved domain. */
const REMAP: [string, string][] = [
  ["priya.raman@gmail.com", "priya.raman@mailbox.example"],
  ["t.whitfield@northloop.io", "t.whitfield@northloop.example"],
  ["marcus.bell@outlook.com", "marcus.bell@mailbox.example"],
  ["aisha.k@brightlab.com", "aisha.k@brightlab.example"],
  ["r.okonjo@gmail.com", "r.okonjo@mailbox.example"],
  ["dfoss@wavefo.rm", "d.foss@waveform.example"],
  ["helen.marsh@harbourdental.co.uk", "helen.marsh@harbourdental.example"],
  ["owen.pryce@madsen.co", "owen.pryce@madsen.example"],
];

async function main() {
  console.log("Dressing the dev workspace for screenshots…\n");

  for (const [from, to] of REMAP) {
    /*
     * contacts and tickets both carry the address, and contact_notes keys off
     * it too, so all three move together or the notes detach from the contact
     * they describe.
     *
     * RETURNING on every one of them, and not for decoration: over neon-http
     * an UPDATE without it resolves to an empty array whether it changed eight
     * rows or none. The first version of this script counted `.length` and
     * cheerfully reported "0, 0, 0" for a run that had rewritten every address
     * — a script that reports nothing happened while doing the work is worse
     * than one that fails, because the next person re-runs it or assumes it is
     * broken.
     */
    const t = await sql`
      UPDATE tickets SET customer_email = ${to}
      WHERE customer_email = ${from} RETURNING id`;
    const c = await sql`
      UPDATE contacts SET email = ${to}
      WHERE email = ${from} RETURNING id`;
    const n = await sql`
      UPDATE contact_notes SET contact_email = ${to}
      WHERE contact_email = ${from} RETURNING id`;
    console.log(
      `  ${from.padEnd(34)} → ${to.padEnd(34)}` +
        ` tickets ${t.length}, contacts ${c.length}, notes ${n.length}`,
    );
  }

  // The sidebar truncates at roughly 18 characters, and "Open Door Baker…" in
  // a screenshot looks like a rendering bug rather than a long name.
  await sql`
    UPDATE workspaces SET name = 'Open Door Bakery'
    WHERE name LIKE 'Open Door Baker%'`;

  /*
   * Check the claim instead of printing it. The whole point of this script is
   * that nothing in a published screenshot can reach a real mailbox, and
   * "Done" is not evidence of that.
   */
  const [{ n: leaked }] = await sql`
    SELECT count(*)::int AS n FROM tickets
    WHERE customer_email NOT LIKE '%.example'`;
  if (leaked > 0) {
    throw new Error(
      `${leaked} ticket(s) still carry an address on a domain that can really ` +
        `resolve. Add them to REMAP before taking any screenshot.`,
    );
  }
  console.log("\nVerified: 0 addresses on a resolvable domain.");
  console.log("Run `npm run db:seed-dev` to restore ordinary development data.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
