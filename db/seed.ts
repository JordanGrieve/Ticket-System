import "./env";
import { db } from "./index";
import { workspaces, agents, contacts, tickets, ticketMessages } from "./schema";
import type { TicketSource, TicketStatus, MessageDirection } from "./schema";
import { eq } from "drizzle-orm";

/**
 * Seeds one demo workspace ("Riverside H&C") with the sample tickets from the
 * design. The first person to sign in claims this workspace (see
 * lib/workspace.ts), so there's real data to develop against.
 *
 * Run: npm run db:seed
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// A stable placeholder that lib/workspace.ts looks for to "claim" the demo.
const SEED_PLACEHOLDER = "SEED_PLACEHOLDER";

type SeedMessage = { direction: MessageDirection; body: string; offset: number };
type SeedTicket = {
  source: TicketSource;
  orderId: string | null;
  name: string;
  email: string;
  subject: string;
  status: TicketStatus;
  ago: number; // ms since now for last activity
  messages: SeedMessage[];
};

const DEMO: SeedTicket[] = [
  {
    source: "order",
    orderId: "ORD-4821",
    name: "Maria Alvarez",
    email: "maria.alvarez@gmail.com",
    subject: "Rescheduling my Thursday appointment",
    status: "open",
    ago: 12 * MIN,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hi there,\n\nSomething's come up at work and I won't be home this Thursday morning for the boiler service. Is there any chance we could push it to Friday, ideally before noon?\n\nSorry for the short notice — thank you!\nMaria",
      },
    ],
  },
  {
    source: "contact_form",
    orderId: null,
    name: "James Okafor",
    email: "j.okafor@outlook.com",
    subject: "Do you cover the north side of town?",
    status: "open",
    ago: 40 * MIN,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hello,\n\nI found you through a neighbour. I'm up near Highfield on the north side — do you service that area? Looking to get an old boiler looked at and possibly replaced.\n\nThanks,\nJames",
      },
    ],
  },
  {
    source: "email",
    orderId: null,
    name: "Priya Nair",
    email: "priya.nair@gmail.com",
    subject: "Invoice question for last week's job",
    status: "in_progress",
    ago: 1 * HOUR,
    messages: [
      {
        direction: "inbound",
        offset: 50 * MIN,
        body: "Hi,\n\nThanks for the quick work last week. I just got the invoice and the total looks a bit higher than the quote you gave me — could you break down the difference for me?\n\nBest,\nPriya",
      },
      {
        direction: "outbound",
        offset: 0,
        body: "Hi Priya,\n\nGood question — the extra was a replacement pressure valve we found was faulty during the visit. I'll forward the itemised breakdown now. Happy to hop on a call if anything's unclear.\n\nThanks,\nRachel",
      },
    ],
  },
  {
    source: "order",
    orderId: "ORD-4795",
    name: "Tom Becker",
    email: "tombecker@gmail.com",
    subject: "Technician was great — quick question",
    status: "open",
    ago: 2 * HOUR,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Morning,\n\nJust wanted to say your technician Dan was brilliant — really tidy and explained everything. One quick thing: is the new part under warranty, and for how long?\n\nCheers,\nTom",
      },
    ],
  },
  {
    source: "email",
    orderId: null,
    name: "Dev Patel",
    email: "dev.patel@gmail.com",
    subject: "Can you come earlier?",
    status: "in_progress",
    ago: 5 * HOUR,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hi,\n\nOur appointment's booked for Wednesday afternoon but my schedule's shifted — any chance of a morning slot instead? Wednesday or Thursday both work.\n\nThanks!\nDev",
      },
    ],
  },
  {
    source: "contact_form",
    orderId: null,
    name: "Sarah Lindqvist",
    email: "sarah.l@gmail.com",
    subject: "Quote for gutter cleaning",
    status: "closed",
    ago: 3 * HOUR,
    messages: [
      {
        direction: "inbound",
        offset: 2 * DAY,
        body: "Hello, could I get a quote for gutter cleaning on a two-storey semi? Thanks, Sarah",
      },
      {
        direction: "outbound",
        offset: 0,
        body: "Hi Sarah, happy to help — that'd be £85 including the downpipes. Let me know a date that suits and I'll pencil you in.\n\nRachel",
      },
    ],
  },
  {
    source: "contact_form",
    orderId: null,
    name: "Grace Chen",
    email: "grace.chen@gmail.com",
    subject: "Availability next week",
    status: "closed",
    ago: 1 * DAY,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hi, do you have any availability next week for an annual service? Flexible on the day. Thanks, Grace",
      },
    ],
  },
  {
    source: "order",
    orderId: "ORD-4770",
    name: "Liam Murphy",
    email: "liam.murphy@gmail.com",
    subject: "Refund for cancelled visit",
    status: "open",
    ago: 1 * DAY,
    messages: [
      {
        direction: "inbound",
        offset: 0,
        body: "Hi,\n\nI had to cancel Saturday's call-out and was told a refund would be processed. Just checking in as I haven't seen it come through yet. Order is ORD-4770.\n\nThanks,\nLiam",
      },
    ],
  },
];

async function main() {
  const now = Date.now();

  // Idempotent: wipe an existing demo workspace so re-seeding is clean.
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.apiKey, "cli_demo_riverside"));
  if (existing.length > 0) {
    await db.delete(workspaces).where(eq(workspaces.id, existing[0].id));
    console.log("Removed previous demo workspace.");
  }

  const [ws] = await db
    .insert(workspaces)
    .values({
      name: "Riverside H&C",
      apiKey: "cli_demo_riverside",
      inboundEmail: "riverside@inbound.yourapp.com",
      sendingEmail: "riverside.hvac@gmail.com",
      accent: "terracotta",
    })
    .returning();

  await db.insert(agents).values({
    workspaceId: ws.id,
    clerkUserId: SEED_PLACEHOLDER,
    email: "owner@riverside.example",
  });

  for (const t of DEMO) {
    const activity = new Date(now - t.ago);

    // Upsert-ish contact (unique on workspace + email).
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

  console.log(`Seeded workspace "${ws.name}" (api_key=${ws.apiKey}) with ${DEMO.length} tickets.`);
  console.log("Sign in to the dashboard and the first account will claim this workspace.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
