import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { admins, type Admin } from "@/db/schema";

/**
 * Super-admin lookups. An admin is a Postbox operator (not a tenant client):
 * matched by email, sees every workspace, and can act within any of them.
 */

/** The admin row for this email, or null. Email match is case-insensitive. */
export async function findAdminByEmail(email: string): Promise<Admin | null> {
  const rows = await db
    .select()
    .from(admins)
    .where(eq(admins.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

/** All admins, oldest first. */
export async function listAdmins(): Promise<Admin[]> {
  return db.select().from(admins).orderBy(asc(admins.createdAt));
}

/** Add an admin by email (idempotent). Returns the existing or new row. */
export async function addAdmin(email: string): Promise<Admin> {
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .insert(admins)
    .values({ email: normalized })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Already existed — return it.
  return (await findAdminByEmail(normalized))!;
}

/** Record the Clerk user id the first time an admin signs in (audit only). */
export async function linkAdminClerkId(
  id: number,
  clerkUserId: string,
): Promise<void> {
  await db.update(admins).set({ clerkUserId }).where(eq(admins.id, id));
}
