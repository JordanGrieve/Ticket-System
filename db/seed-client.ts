import "./env";
import { db } from "./index";
import { workspaces, agents, contacts, tickets, ticketMessages } from "./schema";
import type { TicketSource, TicketStatus, MessageDirection } from "./schema";
import { eq } from "drizzle-orm";

/**
 * Seeds a SECOND demo client ("Bloom & Stem", a florist) so the super-admin
 * overview shows more than one workspace to switch between. Idempotent — wipes
 * and recreates by api key. Uses a distinct agent placeholder so it doesn't
 * collide with Riverside's SEED_PLACEHOLDER (agents.clerk_user_id is unique).
 *
 * Run: npm run db:seed-client
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type SeedMessage = { direction: MessageDirection; body: string; offset: number };
type SeedTicket = {
  source: TicketSource;
  orderId: string | null;
  name: string;
  email: string;
  subject: string;
  status: TicketStatus;
  ago: number;
  messages: SeedMessage[];
};

const DEMO: SeedTicket[] = [
  {
    source: "order",
    orderId: "ORD-2210",
    name: "Hannah Wills",
    email: "hannah.wills@gmail.com",
    subject: "Can I change the delivery address?",
    status: "open",
    ago: 8 * MIN,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hi,\n\nI ordered the peony bouquet for Saturday (ORD-2210) but I need it sent to my mum's house instead — 14 Elm Road rather than my flat. Is that still possible?\n\nThanks so much!\nHannah",
      },
    ],
  },
  {
    source: "contact_form",
    orderId: null,
    name: "Marcus Reid",
    email: "m.reid@outlook.com",
    subject: "Do you do wedding flowers?",
    status: "open",
    ago: 55 * MIN,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hello,\n\nWe're getting married in September and love your style. Do you take on full wedding orders (bouquets, table arrangements, buttonholes)? Roughly 60 guests.\n\nBest,\nMarcus",
      },
    ],
  },
  {
    source: "email",
    orderId: null,
    name: "Sofia Marchetti",
    email: "sofia.m@gmail.com",
    subject: "One of the stems arrived wilted",
    status: "in_progress",
    ago: 3 * HOUR,
    messages: [
      {
        direction: "inbound",
        offset: 40 * MIN,
        body: "Hi,\n\nThe arrangement was lovely but one of the roses looked quite wilted on arrival. Not a big deal but thought you'd want to know.\n\nSofia",
      },
      {
        direction: "outbound",
        offset: 0,
        body: "Hi Sofia,\n\nSo sorry about that — that's not our standard at all. I'll pop a fresh stem in the post to you today, and a little something extra. Thank you for letting us know!\n\nEleanor",
      },
    ],
  },
  {
    source: "order",
    orderId: "ORD-2188",
    name: "David Cole",
    email: "davidcole@gmail.com",
    subject: "Thank you — beautiful arrangement",
    status: "closed",
    ago: 1 * DAY,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Just wanted to say the anniversary bouquet was stunning and arrived right on time. My wife loved it. Will definitely order again!\n\nDavid",
      },
    ],
  },
  {
    source: "contact_form",
    orderId: null,
    name: "Priya Shah",
    email: "priya.shah@gmail.com",
    subject: "Weekly office flowers?",
    status: "open",
    ago: 6 * HOUR,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hi there, do you offer a weekly subscription for office flowers? We'd want a fresh arrangement delivered every Monday to our reception. Thanks, Priya",
      },
    ],
  },
];

async function main() {
  const now = Date.now();
  const API_KEY = "cli_demo_bloom";

  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.apiKey, API_KEY));
  if (existing.length > 0) {
    await db.delete(workspaces).where(eq(workspaces.id, existing[0].id));
    console.log("Removed previous Bloom & Stem workspace.");
  }

  const [ws] = await db
    .insert(workspaces)
    .values({
      name: "Bloom & Stem",
      apiKey: API_KEY,
      inboundEmail: "bloom@inbound.yourapp.com",
      sendingEmail: "hello@bloomandstem.example",
      accent: "rose",
    })
    .returning();

  await db.insert(agents).values({
    workspaceId: ws.id,
    // Distinct from Riverside's SEED_PLACEHOLDER (clerk_user_id is unique).
    clerkUserId: "SEED_PLACEHOLDER_BLOOM",
    email: "owner@bloomandstem.example",
  });

  for (const t of DEMO) {
    const activity = new Date(now - t.ago);

    await db
      .insert(contacts)
      .values({ workspaceId: ws.id, name: t.name, email: t.email, firstSeen: activity })
      .onConflictDoNothing();

    const [ticket] = await db
      .insert(tickets)
      .values({
        workspaceId: ws.id,
        source: t.source,
        orderId: t.orderId,
        customerName: t.name,
        customerEmail: t.email,
        subject: t.subject,
        status: t.status,
        createdAt: activity,
        updatedAt: activity,
      })
      .returning();

    for (const m of t.messages) {
      await db.insert(ticketMessages).values({
        ticketId: ticket.id,
        direction: m.direction,
        body: m.body,
        sentAt: new Date(now - t.ago - m.offset),
      });
    }
  }

  console.log(
    `Seeded workspace "${ws.name}" (api_key=${ws.apiKey}) with ${DEMO.length} tickets.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
