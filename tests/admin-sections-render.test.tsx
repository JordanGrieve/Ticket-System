import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import {
  AccessSection,
  AccountsSection,
  BillingSection,
  DeliverabilitySection,
  SupportSection,
  OverviewSection,
} from "../app/(admin)/admin/sections";

/**
 * Every pane of the admin console renders.
 *
 * ── THE CONSOLE IS THE ONE SCREEN NOBODY CAN JUST OPEN ──
 * It sits behind requireAdmin(), so looking at it needs a real super-admin
 * login, and that is exactly why things have rotted here unseen: two
 * diagnostic tables shipped as single-column stacks because `.pba-row` had no
 * grid-template, and neither had ever been viewed in a browser. Nothing in the
 * suite rendered these components at all.
 *
 * Every section is a pure component over props, so they can be rendered here
 * with fixtures — no database, no auth. A section that throws on a null owner
 * or an unended session now fails in CI instead of on the operator's screen
 * during the incident that made them open the console.
 *
 * ── IT ALSO BUILDS THE MOBILE HARNESS ──
 * Set ADMIN_HARNESS_OUT to a directory and it writes each pane as a standalone
 * page, dressed in the real stylesheets and carrying the probes in
 * ./admin-audit-probes.js. Point a browser at it to audit the console at any
 * width without an account:
 *
 *   ADMIN_HARNESS_OUT=$PWD/public/_ah npx vitest run tests/admin-sections-render
 *
 * then open /_ah/overview.html and call __selftest(), __overflow(),
 * __contrast() and __targets(). Unset, it writes nothing and CI just checks
 * that the panes render.
 */

const OUT = process.env.ADMIN_HARNESS_OUT;

const now = new Date("2026-09-06T11:20:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3600_000);

const sessions = [
  {
    id: 1,
    adminEmail: "jordangrieve.dev@gmail.com",
    adminId: 1,
    adminClerkUserId: "user_2abcdefghijklmnopqrstuvwx",
    workspaceId: 3,
    workspaceName: "Open Door Bakery",
    startedAt: ago(2),
    lastSeenAt: ago(1),
    endedAt: null,
    endedReason: null,
    reason: "Customer reported a reply that never arrived — checking delivery",
  },
  {
    id: 2,
    adminEmail: "someone.with.a.long.address@postbox.help",
    adminId: null,
    adminClerkUserId: null,
    workspaceId: null,
    workspaceName: "Riverside Framing",
    startedAt: ago(50),
    lastSeenAt: ago(50),
    endedAt: ago(49),
    endedReason: "signed_out",
    reason: null,
  },
] as never;

const reads = new Map([
  [
    1,
    [
      { ticketId: 41, count: 3, firstAt: ago(2), lastAt: ago(1) },
      { ticketId: 44, count: 1, firstAt: ago(2), lastAt: ago(2) },
    ],
  ],
]) as never;

const chain = {
  ok: true,
  keyed: true,
  total: 2,
  legacyUnverified: 0,
  verified: 2,
  firstBreak: null,
} as never;

const workspace = (over: Record<string, unknown>) =>
  ({
    id: 3,
    name: "Open Door Bakery",
    apiKey: "cli_abc123",
    inboundEmail: "bakery@inbound.postbox.help",
    sendingEmail: "hello@opendoorbakery.co.uk",
    accent: "terracotta",
    legalName: "Open Door Bakery Ltd",
    postalAddress: "12 Mill Lane, Stroud, GL5 1AB",
    plan: "starter",
    stripeCustomerId: "cus_abc",
    stripeSubscriptionId: "sub_abc",
    stripeStatus: "active",
    currentPeriodEnd: ago(-400),
    trialStartedAt: ago(2000),
    createdAt: ago(2000),
    openCount: 3,
    totalCount: 24,
    ownerEmail: "hello@opendoorbakery.co.uk",
    pending: false,
    firstTicketAt: ago(1800),
    lastTicketAt: ago(30),
    ...over,
  }) as never;

const accounts = [
  workspace({}),
  // The awkward one: a long name, no owner yet, nothing ever received.
  workspace({
    id: 4,
    name: "Riverside Framing & Restoration Company",
    ownerEmail: "INVITE_pending@riverside-framing-and-restoration.co.uk",
    pending: true,
    plan: "trial",
    stripeStatus: null,
    openCount: 0,
    totalCount: 0,
    firstTicketAt: null,
    lastTicketAt: null,
  }),
] as never;

const usage = new Map([
  [3, { subscribers: 118, ticketsInWindow: 24 }],
  [4, { subscribers: 0, ticketsInWindow: 0 }],
]) as never;

const gates = {
  stripeConfigured: true,
  allPricesConfigured: true,
  transactionalSending: true,
  transactionalFeedback: false,
  campaignDeliveryLive: false,
  campaignFeedback: false,
  contactFormLive: false,
} as never;

const admins = [
  { id: 1, email: "jordangrieve.dev@gmail.com", clerkUserId: "user_2abc", createdAt: ago(2000) },
] as never;

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="./globals.css">
<link rel="stylesheet" href="./admin.css">
<link rel="stylesheet" href="./console.css">
<link rel="stylesheet" href="./access-log.css">
</head><body><div class="pba-root" data-theme="dark">${body}</div>
<script src="./audit.js"></script></body></html>`;
}

/** The console shell from app/(admin)/admin/page.tsx, around a pane. */
function shell(pane: string) {
  return `<div class="pba-page"><div class="pba-shell">
  <nav class="pba-side">
    <div class="pba-brand"><span class="pba-brand-tile"></span>
      <span><span class="pba-brand-name">Postbox</span><span class="pba-brand-sub">Internal admin</span></span></div>
    <div class="pba-divider"></div>
    <div class="pba-nav">
      <a class="pba-navrow is-active"><span class="pba-navlabel">Overview</span></a>
      <a class="pba-navrow"><span class="pba-navlabel">Accounts</span></a>
      <a class="pba-navrow"><span class="pba-navlabel">Access log</span></a>
      <a class="pba-navrow"><span class="pba-navlabel">Billing</span></a>
      <a class="pba-navrow"><span class="pba-navlabel">Deliverability</span></a>
      <a class="pba-navrow"><span class="pba-navlabel">Support</span></a>
    </div>
    <div class="pba-side-foot"><div class="pba-whoami">
      <div class="pba-whoami-label">Signed in as</div>
      <div class="pba-whoami-email">jordangrieve.dev@gmail.com</div>
      <button class="pba-signout">Sign out</button></div></div>
  </nav>
  <div class="pba-main">
    <header class="pba-header">
      <div class="pba-htitles"><h1 class="pba-htitle">Operator access</h1>
        <p class="pba-hsub">Every visit into a client workspace</p></div>
      <div class="pba-hactions">
        <form class="pba-search"><input type="search" placeholder="Search accounts…" aria-label="Search accounts"></form>
        <a class="pba-btn pba-btn-primary">New account</a>
      </div>
    </header>
    <div class="pba-body"><main class="pba-content">${pane}</main></div>
  </div>
</div></div>`;
}

const panes: Record<string, React.ReactElement> = {
      access: (
        <AccessSection
          sessions={sessions}
          actions={[] as never}
          chain={chain}
          actionChain={chain}
          reads={reads}
        />
      ),
      accounts: (
        <AccountsSection
          accounts={accounts}
          visible={accounts}
          query={{ section: "accounts", filter: "all", q: "" } as never}
          deleteTarget={null}
        />
      ),
      overview: <OverviewSection accounts={accounts} gates={gates} />,
      billing: <BillingSection accounts={accounts} usage={usage} gates={gates} />,
      deliverability: (
        <DeliverabilitySection
          accounts={accounts}
          rejections={
            [
              {
                reason: "unknown_api_key",
                keyPrefix: "cli_9f2",
                workspaceId: null,
                count: 4182,
                firstSeenAt: ago(1000),
                lastSeenAt: ago(3),
              },
            ] as never
          }
          drops={
            [
              {
                reason: "no_matching_recipient",
                eventType: "Bounce",
                lastMessageId: "0100019a2b3c4d5e-abcdef01-2345-6789-abcd-ef0123456789-000000",
                count: 2,
                firstSeenAt: ago(40),
                lastSeenAt: ago(9),
              },
            ] as never
          }
          transactional={
            {
              byStatus: { queued: 2, sent: 9, delivered: 118, bounced: 1, complained: 0, failed: 1 },
              unrecorded: 40,
              total: 171,
            } as never
          }
          campaignTotals={
            {
              recipients: { pending: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0 },
              campaigns: { draft: 1, scheduled: 0, sending: 0, sent: 0, failed: 0 },
            } as never
          }
          gates={gates}
        />
      ),
  support: <SupportSection admins={admins} viewerEmail="jordangrieve.dev@gmail.com" />,
};

describe("every admin pane renders", () => {
  const rendered: Record<string, string> = {};

  for (const [name, node] of Object.entries(panes)) {
    it(name, () => {
      // Deliberately NOT wrapped in a try/catch. A pane that throws must fail
      // the test with its own stack, not be swallowed into a placeholder.
      const html = renderToStaticMarkup(node);
      rendered[name] = html;
      // Rendering "" would satisfy "did not throw" and prove nothing.
      expect(html.length, `${name} rendered nothing`).toBeGreaterThan(400);
      expect(html, `${name} lost its wrapper`).toContain("pba-");
    });
  }

  it("writes the browser harness when asked", () => {
    if (!OUT) return; // CI: rendering above is the whole check
    mkdirSync(OUT, { recursive: true });

    // The real stylesheets, beside the markup, so the harness is dressed in
    // exactly what ships rather than in a copy that has drifted.
    for (const src of [
      "app/globals.css",
      "app/admin.css",
      "app/(admin)/admin/console.css",
      "app/(admin)/access-log.css",
    ]) {
      copyFileSync(join(process.cwd(), src), join(OUT, src.split("/").pop()!));
    }
    copyFileSync(
      join(process.cwd(), "tests/admin-audit-probes.js"),
      join(OUT, "audit.js"),
    );

    for (const [name, node] of Object.entries(panes)) {
      writeFileSync(
        join(OUT, `${name}.html`),
        page(name, shell(renderToStaticMarkup(node))),
        "utf8",
      );
    }
  });
});
