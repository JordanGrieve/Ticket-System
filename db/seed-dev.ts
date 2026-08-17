import "./env";
import { db } from "./index";
import {
  workspaces,
  agents,
  contacts,
  tickets,
  ticketMessages,
  labels,
  ticketLabels,
} from "./schema";
import type {
  TicketSource,
  TicketStatus,
  MessageDirection,
  LabelColor,
} from "./schema";
import { eq } from "drizzle-orm";
import { generateReplyToken } from "../lib/tokens";

/**
 * Seeds "DevBusiness" — a throwaway workspace for looking at the UI with real
 * data in it.
 *
 * WHY A SEPARATE WORKSPACE, not the pilot client's: this database is the
 * production one (there is still no dev branch), so writing invented enquiries
 * into a live customer's workspace would put fake people in an account they
 * can log into. This creates its own workspace instead, deletable in one click
 * from /admin.
 *
 * NOT CLAIMABLE. The placeholder agent's address is on `.example`, a reserved
 * TLD that cannot be registered, so nobody can ever sign in and take this
 * workspace over. That matters: "first sign-up claims the seed" was a real
 * account-takeover hole in this product once already.
 *
 * NO EMAIL IS SENT. Everything is written straight to the database, so the
 * notification and auto-reply paths — which live in the API routes — never run.
 *
 * Idempotent: re-running wipes and recreates by api key.
 *
 * Run: npm run db:seed-dev
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const API_KEY = "cli_demo_devbusiness";
const PLACEHOLDER = "SEED_PLACEHOLDER_DEVBUSINESS";

type SeedMessage = {
  direction: MessageDirection;
  body: string;
  /** ms before now */
  offset: number;
  automated?: boolean;
};

type SeedTicket = {
  source: TicketSource;
  status: TicketStatus;
  customerName: string;
  customerEmail: string;
  subject: string;
  orderId?: string;
  label?: string;
  messages: SeedMessage[];
};

/** Deliberately varied: every source, every status, threads of every length. */
const SEED: SeedTicket[] = [
  {
    source: "contact_form",
    status: "open",
    customerName: "Priya Raman",
    customerEmail: "priya.raman@gmail.com",
    subject: "Do you cater for gluten-free events?",
    label: "Sales",
    messages: [
      {
        direction: "inbound",
        offset: 40 * MIN,
        body: "Hi! I'm organising a team lunch for 25 people on the 12th and three of them are coeliac. Is that something you can handle, and would it need a separate kitchen slot?",
      },
    ],
  },
  {
    source: "email",
    status: "in_progress",
    customerName: "Tom Whitfield",
    customerEmail: "t.whitfield@northloop.io",
    subject: "Invoice 3391 — wrong VAT rate?",
    label: "Billing",
    messages: [
      {
        direction: "inbound",
        offset: 5 * HOUR,
        body: "Morning — invoice 3391 came through at 20% VAT but I think the catering portion should be zero-rated. Could you take a look before I put it through?",
      },
      {
        direction: "outbound",
        offset: 4 * HOUR,
        body: "Thanks Tom, good spot. I've asked our bookkeeper to check the split and I'll come back to you today with either a corrected invoice or an explanation.",
      },
      {
        direction: "inbound",
        offset: 90 * MIN,
        body: "Perfect, no rush — I'll hold off paying until I hear back.",
      },
    ],
  },
  {
    source: "order",
    status: "open",
    orderId: "ORD-4821",
    customerName: "Marcus Bell",
    customerEmail: "marcus.bell@outlook.com",
    subject: "ORD-4821 arrived damaged",
    label: "Urgent",
    messages: [
      {
        direction: "inbound",
        offset: 2 * HOUR,
        body: "Order ORD-4821 turned up this morning and two of the six jars were broken in transit. Photos attached. Happy with a replacement rather than a refund if that's easier.",
      },
    ],
  },
  {
    source: "contact_form",
    status: "open",
    customerName: "Aisha Khan",
    customerEmail: "aisha.k@brightlab.com",
    subject: "Wholesale pricing for a monthly order",
    label: "Sales",
    messages: [
      {
        direction: "inbound",
        offset: 1 * DAY,
        body: "We'd be looking at roughly 40 units a month on a standing order. Do you do wholesale rates at that volume, and is there a minimum term?",
      },
      {
        direction: "outbound",
        offset: 20 * HOUR,
        body: "Hi Aisha — yes, we price wholesale from 25 units a month and there's no minimum term. I've attached the current rate card. Shall I put a sample box in the post?",
      },
    ],
  },
  {
    source: "email",
    status: "closed",
    customerName: "Rachel Okonjo",
    customerEmail: "r.okonjo@gmail.com",
    subject: "Changed my collection time",
    messages: [
      {
        direction: "inbound",
        offset: 3 * DAY,
        body: "Could I move Saturday's collection from 9am to about 11:30? Something's come up.",
      },
      {
        direction: "outbound",
        offset: 3 * DAY - 40 * MIN,
        body: "No problem at all Rachel — I've moved you to 11:30 on Saturday. See you then.",
      },
      {
        direction: "inbound",
        offset: 3 * DAY - 55 * MIN,
        body: "Brilliant, thank you!",
      },
    ],
  },
  {
    source: "contact_form",
    status: "open",
    customerName: "Daniel Foss",
    customerEmail: "dfoss@wavefo.rm",
    subject: "Is the Tuesday class still running?",
    messages: [
      {
        direction: "inbound",
        offset: 6 * HOUR,
        body: "The website still lists the Tuesday evening class but the booking page 404s. Is it still on?",
      },
      {
        direction: "outbound",
        offset: 5 * HOUR,
        // Shows the auto-reply styling and the "automated" flag in the thread.
        automated: true,
        body: "Thanks for getting in touch — your message has reached us and we'll come back to you as soon as we can.",
      },
    ],
  },
  {
    source: "order",
    status: "in_progress",
    orderId: "ORD-4795",
    customerName: "Helen Marsh",
    customerEmail: "helen.marsh@harbourdental.co.uk",
    subject: "ORD-4795 — can I add to this before it ships?",
    label: "Urgent",
    messages: [
      {
        direction: "inbound",
        offset: 26 * HOUR,
        body: "I placed ORD-4795 last night — is it too late to add two more of the large boxes to the same delivery?",
      },
      {
        direction: "outbound",
        offset: 25 * HOUR,
        body: "Caught it just in time — the order hadn't gone to packing yet. I've added two large boxes and the balance is on the updated invoice.",
      },
    ],
  },
  {
    source: "email",
    status: "open",
    customerName: "Owen Pryce",
    customerEmail: "owen.pryce@madsen.co",
    subject: "Allergen list for the autumn range",
    label: "Sales",
    messages: [
      {
        direction: "inbound",
        offset: 11 * HOUR,
        body: "Do you have the full allergen breakdown for the autumn range anywhere? Our HR team needs it before we can order for the office.",
      },
    ],
  },
];

const LABELS: { name: string; color: LabelColor }[] = [
  { name: "Sales", color: "tag_a" },
  { name: "Billing", color: "tag_b" },
  { name: "Urgent", color: "tag_c" },
];

async function main() {
  const now = Date.now();

  // Idempotent: drop a previous run. Cascades take the children with it.
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.apiKey, API_KEY));
  if (existing.length > 0) {
    await db.delete(workspaces).where(eq(workspaces.id, existing[0].id));
    console.log("Removed the previous DevBusiness workspace.");
  }

  const [ws] = await db
    .insert(workspaces)
    .values({
      name: "DevBusiness",
      apiKey: API_KEY,
      inboundEmail: "devbusiness-d4f1a2@postbox.help",
      sendingEmail: "hello@devbusiness.example",
      // A theme key since the pivot. Left on the default light palette.
      accent: "system",
    })
    .returning();

  await db.insert(agents).values({
    workspaceId: ws.id,
    // .example cannot be registered, so this workspace can never be claimed.
    clerkUserId: PLACEHOLDER,
    email: "owner@devbusiness.example",
  });

  const labelRows = await db
    .insert(labels)
    .values(LABELS.map((l) => ({ workspaceId: ws.id, ...l })))
    .returning();
  const labelByName = new Map(labelRows.map((l) => [l.name, l.id]));

  // One contact per distinct customer, first-seen at their oldest message.
  const oldestByEmail = new Map<string, { name: string; at: number }>();
  for (const t of SEED) {
    const oldest = Math.max(...t.messages.map((m) => m.offset));
    const prev = oldestByEmail.get(t.customerEmail);
    if (!prev || oldest > prev.at) {
      oldestByEmail.set(t.customerEmail, { name: t.customerName, at: oldest });
    }
  }
  await db.insert(contacts).values(
    [...oldestByEmail].map(([email, v]) => ({
      workspaceId: ws.id,
      name: v.name,
      email,
      firstSeen: new Date(now - v.at),
    })),
  );

  for (const t of SEED) {
    const newest = Math.min(...t.messages.map((m) => m.offset));
    const oldest = Math.max(...t.messages.map((m) => m.offset));

    const [ticket] = await db
      .insert(tickets)
      .values({
        workspaceId: ws.id,
        source: t.source,
        replyToken: generateReplyToken(),
        orderId: t.orderId ?? null,
        customerName: t.customerName,
        customerEmail: t.customerEmail,
        subject: t.subject,
        status: t.status,
        createdAt: new Date(now - oldest),
        // Drives inbox ordering, so it must be the newest message.
        updatedAt: new Date(now - newest),
      })
      .returning();

    await db.insert(ticketMessages).values(
      t.messages.map((m) => ({
        ticketId: ticket.id,
        direction: m.direction,
        body: m.body,
        automated: m.automated ?? false,
        deliveryStatus: m.direction === "outbound" ? ("delivered" as const) : null,
        sentAt: new Date(now - m.offset),
      })),
    );

    const labelId = t.label ? labelByName.get(t.label) : undefined;
    if (labelId) {
      await db.insert(ticketLabels).values({ ticketId: ticket.id, labelId });
    }
  }

  const awaiting = SEED.filter(
    (t) =>
      t.status !== "closed" &&
      t.messages.reduce((a, b) => (a.offset < b.offset ? a : b)).direction ===
        "inbound",
  ).length;

  console.log(`\nSeeded "DevBusiness" (workspace ${ws.id})`);
  console.log(`  ${SEED.length} tickets · ${oldestByEmail.size} contacts · ${LABELS.length} labels`);
  console.log(`  ${awaiting} awaiting reply · ${SEED.filter((t) => t.status === "closed").length} closed`);
  console.log(`\nOpen it from /admin → Accounts → DevBusiness → Open workspace.`);
  console.log(`Delete it the same way when you're done.\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
