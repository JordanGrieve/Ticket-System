import { cache } from "react";
import { headers } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { workspaces, agents, type Workspace, type Agent } from "@/db/schema";
import { INBOUND_DOMAIN, OPEN_SIGNUP } from "./config";
import { forwardedIp } from "./http";
import { rateLimitDurable } from "./rate-limit-store";

import { seedStarterLabels } from "./labels";

/**
 * Self-serve workspaces one address may create per hour.
 *
 * Five, not one. A legitimate person creates a single workspace, so any number
 * above one is slack rather than permission — and slack matters because an
 * office, a university or a phone network can put many unrelated people behind
 * one address. A limit that fires on the second honest signup from a shared
 * connection would be a support problem forever, to stop an attacker who is
 * only inconvenienced by it.
 */
const SIGNUPS_PER_IP_PER_HOUR = 5;

/**
 * Placeholder clerkUserId prefixes for agents whose human hasn't signed in yet.
 *  - SEED_…   demo workspaces created by db/seed scripts
 *  - INVITE_… client workspaces created by an admin from /admin
 * A signer whose email matches a placeholder agent claims that workspace on
 * first login (see resolveWorkspace). Never claimed by email mismatch.
 */
export const INVITE_PREFIX = "INVITE_";

export function isPlaceholderClerkId(clerkUserId: string): boolean {
  return clerkUserId.startsWith("SEED_") || clerkUserId.startsWith(INVITE_PREFIX);
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "workspace"
  );
}

export function generateApiKey(): string {
  return `cli_${randomHex(16)}`;
}

export type ResolvedWorkspace = { workspace: Workspace; agent: Agent };

/**
 * Creates a workspace + its first agent row. Used by self-serve sign-up (real
 * clerkUserId) and by the admin "add client" flow (INVITE_… placeholder that
 * the client claims on first sign-in).
 */
export async function provisionWorkspace(input: {
  name: string;
  ownerEmail: string;
  clerkUserId: string;
}): Promise<ResolvedWorkspace> {
  const base = slugify(input.name);
  const inboundEmail = `${base}-${randomHex(3)}@${INBOUND_DOMAIN}`;
  const email = input.ownerEmail.trim().toLowerCase();

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: input.name,
      apiKey: generateApiKey(),
      inboundEmail,
      sendingEmail: email,
      accent: "terracotta",
    })
    .returning();

  const [agent] = await db
    .insert(agents)
    .values({ workspaceId: workspace.id, clerkUserId: input.clerkUserId, email })
    .returning();

  /*
    Starter labels — a suggestion, not part of the account.

    Deliberately after the two inserts above and deliberately swallowed. Both
    rows are already committed by this point and neon-http gives us no
    transaction to unwind them with, so a throw here would leave a real
    workspace behind an error screen. Three decorative rows are not worth that.

    The consequence is stated rather than hidden: a workspace can exist with no
    labels, which is exactly the state every workspace was in before this, and
    the picker still works.
  */
  try {
    await seedStarterLabels(workspace.id);
  } catch (err) {
    console.error("[workspace] starter labels not created:", err);
  }

  return { workspace, agent };
}

/**
 * Returns the workspace for the signed-in user, or null when they have none
 * and may not create one (invite-only mode).
 *
 * Onboarding logic, in order:
 *  1. Existing agent → their workspace.
 *  2. A placeholder agent (admin invite or demo seed) whose email matches the
 *     signer's email → claim that workspace. Email must match: a stranger can
 *     never claim someone else's invite or the demo data.
 *  3. Otherwise: OPEN_SIGNUP=true → provision a fresh workspace (self-serve);
 *     default → null (invite-only — the caller shows /no-access).
 *
 * Throws if there is no authenticated user (callers run behind auth).
 */
export const resolveWorkspace = cache(_resolveWorkspace);

async function _resolveWorkspace(): Promise<ResolvedWorkspace | null> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // 1. Existing membership.
  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.clerkUserId, userId))
    .limit(1);

  if (existing.length > 0) {
    const agent = existing[0];
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, agent.workspaceId))
      .limit(1);
    return { workspace, agent };
  }

  const user = await currentUser();
  const email = (
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "owner@example.com"
  )
    .trim()
    .toLowerCase();

  // 2. Claim a pending invite (or demo seed) that was prepared for this email.
  const invited = await db
    .select()
    .from(agents)
    .where(
      sql`lower(${agents.email}) = ${email} AND (${or(
        like(agents.clerkUserId, "SEED_%"),
        like(agents.clerkUserId, `${INVITE_PREFIX}%`),
      )})`,
    )
    .limit(1);

  if (invited.length > 0) {
    const [claimed] = await db
      .update(agents)
      .set({ clerkUserId: userId, email })
      .where(eq(agents.id, invited[0].id))
      .returning();
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, claimed.workspaceId))
      .limit(1);
    return { workspace, agent: claimed };
  }

  // 3. No invite. Invite-only (default): no workspace — never hand strangers
  // a tenant (it includes sending email from our domain). Self-serve only
  // when explicitly enabled.
  if (!OPEN_SIGNUP) return null;

  /*
    ── RATE LIMIT, SELF-SERVE ONLY ──
    Named on SELF-SERVE 6 as a prerequisite for opening signup, and this is
    what it is protecting: every workspace created here gets an inbound address
    on our domain and the ability to send mail on our reputation. That is the
    thing invite-only was guarding, and flipping OPEN_SIGNUP hands it to
    anybody who can make Clerk accounts.

    ── WHY HERE AND NOT INSIDE provisionWorkspace ──
    provisionWorkspace is also the admin "add client" flow. An operator setting
    up six clients in an afternoon is doing their job, and a limit that counted
    those would fire on the one caller that should never be throttled. So it
    guards the self-serve branch only — the one where the person on the other
    end is a stranger.

    ── FAILING OPEN IS SAFE HERE, UNUSUALLY ──
    rateLimitDurable degrades to allowing the request when the database is
    unreachable, which is a deliberate choice for public forms. That would
    normally be uncomfortable on a creation path, but it costs nothing here:
    the very next thing this function does is INSERT a workspace, so an outage
    that stops the limiter from counting also stops the thing it is counting.

    ── A NULL IP IS NOT A FREE PASS ──
    Everything with no forwarded IP shares one bucket. That is deliberately
    crude: it means a proxy that strips the header throttles all its users
    together, which is worse for them and correct for us. The alternative —
    skipping the limit when the IP is unknown — makes the control removable by
    the attacker, who only has to strip a header.
  */
  const headerBag = await headers();
  const ip = forwardedIp((name) => headerBag.get(name));
  const created = await rateLimitDurable(`signup:ip:${ip ?? "unknown"}`, {
    max: SIGNUPS_PER_IP_PER_HOUR,
    windowMs: 60 * 60_000,
  });
  if (!created.ok) {
    console.warn(`[workspace] self-serve signup rate limited for ip=${ip ?? "unknown"}`);
    /*
      Null, so the caller shows /no-access.

      Not the message this deserves — "try again later" would be truer than
      "no access" — and worth naming rather than leaving to be discovered. It
      is tolerable because a legitimate person creates one workspace and would
      have to make six Clerk accounts from one address within an hour to see
      it. If self-serve ever runs at volume this needs its own screen.
    */
    return null;
  }

  const name =
    user?.firstName || user?.username
      ? `${user?.firstName ?? user?.username}'s workspace`
      : "My workspace";

  return provisionWorkspace({ name, ownerEmail: email, clerkUserId: userId });
}
