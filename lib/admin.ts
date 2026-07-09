import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { admins, type Admin } from "@/db/schema";
import { getRealAgentByEmail } from "./data";

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

/** The admin row linked to this Clerk user id, or null. */
export async function findAdminByClerkId(
  clerkUserId: string,
): Promise<Admin | null> {
  const rows = await db
    .select()
    .from(admins)
    .where(eq(admins.clerkUserId, clerkUserId))
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
  const [inserted] = await db
    .insert(admins)
    .values({ email: normalized })
    .onConflictDoNothing()
    .returning();
  const admin = inserted ?? (await findAdminByEmail(normalized))!;

  // If this person has already signed in as a client (has a real agent row),
  // link their Clerk id now. Then resolveViewer recognises them as an admin by
  // id on their next request — no Clerk API lookup, and no chance of being
  // mistaken for a client. (New admins with no agent get linked on first login.)
  if (!admin.clerkUserId) {
    const agent = await getRealAgentByEmail(normalized);
    if (agent) {
      await linkAdminClerkId(admin.id, agent.clerkUserId);
      admin.clerkUserId = agent.clerkUserId;
    }
  }

  return admin;
}

/** Record the Clerk user id the first time an admin signs in (audit only). */
export async function linkAdminClerkId(
  id: number,
  clerkUserId: string,
): Promise<void> {
  await db.update(admins).set({ clerkUserId }).where(eq(admins.id, id));
}
