import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/*
  The router these views read.

  MessageList, LabelManager and Thread call usePathname / useSearchParams to
  keep the current folder, page and label filter in the links they build.
  Outside a request there is no router and those throw "invariant expected app
  router to be mounted", so a stand-in supplies the one route the fixtures are
  written for.

  It is a stand-in for the ROUTE, not for the components' behaviour: every
  view below still runs its own real code. The links it produces are the links
  for /inbox with no filter, which is what the harness is auditing.
*/
vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams("folder=inbox"),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    prefetch: () => {},
  }),
  useParams: () => ({}),
}));
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import MessageList from "../components/mail/MessageList";
import ContactRail from "../components/mail/ContactRail";
import LabelManager from "../components/mail/LabelManager";
import OnboardingChecklist from "../components/mail/OnboardingChecklist";
import SharedLinks from "../components/mail/SharedLinks";
import Thread from "../components/mail/Thread";

/**
 * Every client-facing mail view renders.
 *
 * The sibling of tests/admin-sections-render.tsx, for the other locked screen.
 * The dashboard is behind a Clerk login AND needs a workspace with data in it,
 * so these views have been checked far less often than their importance
 * deserves — they are what Open Door Bakery actually looks at.
 *
 * These are client components over props, so they render here with fixtures.
 * That is worth having on its own (a view that throws on a null order id now
 * fails in CI), and it also builds the browser harness: set MAIL_HARNESS_OUT
 * and each view is written as a standalone page in the real stylesheets, with
 * the probes from tests/audit-probes.js.
 *
 *   MAIL_HARNESS_OUT=$PWD/public/_mh npx vitest run tests/mail-views-render
 *
 * Then open /_mh/inbox.html at any width, in any of the six themes, and call
 * __selftest(), __overflow(), __contrast(), __targets().
 *
 * ── WHAT THE FIXTURES ARE FOR ──
 * Not a happy path. The row set below is deliberately the awkward one: a name
 * longer than the column, an address with no display name, an empty preview,
 * a ticket with no order id, and four labels on one row. Those are the shapes
 * that break a layout, and a fixture that only holds "Jane Smith · Order 1182"
 * proves the view can render the one case nobody worried about.
 */

const OUT = process.env.MAIL_HARNESS_OUT;

const iso = (h: number) => new Date(Date.UTC(2026, 8, 6, 11, 20) - h * 3600_000).toISOString();

const labels = [
  { id: 1, name: "Wholesale", color: "tag_a", colorHex: null },
  { id: 2, name: "Complaint", color: "tag_b", colorHex: null },
  { id: 3, name: "Christmas orders 2026", color: "tag_c", colorHex: "#3d7dd8" },
  { id: 4, name: "VIP", color: "tag_a", colorHex: null },
] as never[];

const rows = [
  {
    id: 41,
    name: "Margarethe Van Der Berg-Whitmore",
    email: "margarethe.vandenberg-whitmore@averylongdomainname.example.co.uk",
    subject: "Order 1182 arrived with the wrong loaf and a missing box of pastries",
    preview:
      "Hello, I placed an order on Tuesday for a sourdough and two boxes of pastries but what arrived was",
    time: "12m",
    sentTime: null,
    sentPreview: "",
    source: "email",
    status: "open",
    orderId: "1182",
    awaitingReply: true,
    unread: true,
    starred: true,
    labels,
  },
  {
    // No display name, empty preview, no order — the sparse end of the range.
    id: 42,
    name: "",
    email: "hello@example.com",
    subject: "",
    preview: "",
    time: "3h",
    sentTime: "2h",
    sentPreview: "Thanks for getting in touch — we can do that for Friday.",
    source: "contact_form",
    status: "closed",
    orderId: null,
    awaitingReply: false,
    unread: false,
    starred: false,
    labels: [],
  },
] as never;

const contact = {
  name: "Margarethe Van Der Berg-Whitmore",
  email: "margarethe.vandenberg-whitmore@averylongdomainname.example.co.uk",
  firstSeenIso: iso(9000),
  ticketCount: 7,
} as never;

const notes = [
  {
    id: 1,
    body: "Wholesale customer — orders every Tuesday for the cafe on Mill Lane. Prefers a call to an email.",
    authorEmail: "hello@opendoorbakery.co.uk",
    createdAtIso: iso(200),
  },
] as never;

const links = [
  { url: "https://opendoorbakery.co.uk/menu/christmas-2026", label: "opendoorbakery.co.uk", messageId: 2 },
] as never;

const ticket = {
  id: 41,
  ref: "ODB-041",
  source: "email",
  orderId: "1182",
  customerName: "Margarethe Van Der Berg-Whitmore",
  customerEmail: "margarethe.vandenberg-whitmore@averylongdomainname.example.co.uk",
  subject: "Order 1182 arrived with the wrong loaf and a missing box of pastries",
  status: "open",
  timeShort: "12m",
} as never;

const messages = [
  {
    id: 1,
    direction: "inbound",
    body: "Hello,\n\nI placed an order on Tuesday for a sourdough and two boxes of pastries, but what arrived was a rye and one box. Could you sort it out before the weekend?\n\nThanks,\nMargarethe",
    sentAtIso: iso(3),
    deliveryStatus: null,
  },
  {
    id: 2,
    direction: "outbound",
    body: "So sorry about that — we'll get the right loaf to you tomorrow morning and refund the missing box. Here is the Christmas menu you asked about: https://opendoorbakery.co.uk/menu/christmas-2026",
    sentAtIso: iso(2),
    deliveryStatus: "bounced",
  },
] as never;

/*
  ── THIS FIXTURE WAS WRONG, AND THE TEST STILL PASSED ──
  It used { key, label }. The real OnboardingStep is { id, title, detail, done,
  href, optional }, so every step rendered with NO TEXT: the render assertion
  (html.length > 200) was satisfied by the card shell, and the accessibility sweep
  of this view measured a checklist with nothing written in it. The only
  finding it produced was on the "Do it" button, whose label is hardcoded.

  A fixture that does not produce real content makes every check over it
  vacuous, which is the same failure as a guard that cannot fail.
*/
const progress = {
  done: 2,
  total: 4,
  steps: [
    {
      id: "test_enquiry",
      title: "Send yourself a test enquiry",
      detail: "Proves the form on your website reaches this inbox.",
      done: true,
      href: "/settings/install",
      optional: false,
    },
    {
      id: "first_reply",
      title: "Answer your first enquiry",
      detail: "Your reply arrives from your own address, not from Postbox.",
      done: true,
      href: "/inbox",
      optional: false,
    },
    {
      id: "auto_reply",
      title: "Switch on an out-of-hours reply",
      detail: "So nobody who writes at 9pm on a Sunday wonders if you got it.",
      done: false,
      href: "/settings/auto-reply",
      optional: false,
    },
    {
      id: "postal_address",
      title: "Add your postal address",
      detail: "Required by law in every newsletter you send.",
      done: false,
      href: "/settings",
      optional: false,
    },
  ],
} as never;

const noop = () => {};

const views: Record<string, React.ReactElement> = {
  inbox: (
    <MessageList
      rows={rows}
      folder="inbox"
      page={1}
      pageCount={3}
      total={57}
      canPersonalise
    />
  ),
  "inbox-empty": (
    <MessageList rows={[]} folder="inbox" page={1} pageCount={1} total={0} canPersonalise />
  ),
  rail: (
    <ContactRail
      contact={contact}
      state="open"
      onClose={noop}
      notes={notes}
      addNote={noop}
      deleteNote={noop}
      links={links}
    />
  ),
  labels: <LabelManager labels={labels.map((l, i) => ({ ...(l as object), ticketCount: [12, 3, 0, 1][i] })) as never} inline />,
  /*
    The same component as a MODAL, which is a different thing to audit: it
    brings a scrim, role="dialog", aria-modal and a close button that the
    inline settings panel deliberately does not have. Every fixture in this
    file was a screen at rest until now, so the modal chrome — the layer most
    likely to trap focus or sit at the wrong contrast — had never been
    rendered.
  */
  "labels-modal": (
    <LabelManager
      labels={labels.map((l, i) => ({ ...(l as object), ticketCount: [12, 3, 0, 1][i] })) as never}
      onClose={noop}
    />
  ),
  onboarding: <OnboardingChecklist progress={progress} />,
  links: <SharedLinks links={links} />,
  thread: (
    <Thread
      ticket={ticket}
      messages={messages}
      hasOlderMessages
      fromAddress="hello@opendoorbakery.co.uk"
      contact={contact}
      notes={notes}
      addNote={noop}
      deleteNote={noop}
      links={links}
      deletedAt={null}
      deletedBy={null}
      trashTicket={noop}
      restoreTicket={noop}
      archivedAt={null}
      snoozedUntil={null}
      wakeIn={null}
      openInMailUrl="mailto:someone@example.com"
      archiveTicket={noop}
      unarchiveTicket={noop}
      snoozeTicket={noop}
      unsnoozeTicket={noop}
      backHref="/inbox"
      starred
      unread={false}
      labels={labels}
      allLabels={labels.map((l) => ({ ...(l as object), ticketCount: 1 })) as never}
      canPersonalise
    />
  ),
};

function page(title: string, body: string) {
  /*
    ── THE THEME IS SET BEFORE THE FIRST PAINT, NOT SWITCHED AFTERWARDS ──
    An earlier version of this harness rendered one page and flipped
    documentElement's data-theme between measurements. It produced nonsense:
    .pbm-card kept reporting the dark --surface while its own computed
    --surface was #ffffff, and it stayed wrong after the 0.16s background
    transition had long finished.

    Whatever that is, it is not how the product behaves — ThemeApplier puts the
    attribute on the root element and the page loads in its theme. So the
    harness does the same: ?theme=slate, set in the head before the body
    parses, and one measurement per load. Reproducing the real mechanism is
    cheaper than explaining a discrepancy in an instrument nobody ships.
  */
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>
  var t = new URLSearchParams(location.search).get("theme");
  if (t) document.documentElement.setAttribute("data-theme", t);
</script>
<link rel="stylesheet" href="./globals.css">
<link rel="stylesheet" href="./mail.css">
<link rel="stylesheet" href="./onboarding.css">
</head><body><div class="pb-shell pbm"><div class="pbm-page">${body}</div></div>
<script src="./audit.js"></script></body></html>`;
}

describe("every client-facing mail view renders", () => {
  for (const [name, node] of Object.entries(views)) {
    it(name, () => {
      // Not wrapped in try/catch: a view that throws must fail with its own
      // stack rather than be swallowed into a placeholder.
      const html = renderToStaticMarkup(node);
      expect(html.length, `${name} rendered nothing`).toBeGreaterThan(200);
    });
  }

  it("every fixture's own text reaches its view", () => {
    /*
      One assertion per view that some value only THIS fixture could supply
      appears in the output. A length check does not do it: the onboarding
      checklist rendered its card, its progress bar and four "Do it" buttons
      from a fixture whose field names were all wrong, and passed — while an
      accessibility sweep over it measured a checklist with no words in it.
    */
    const pairs: [string, string][] = [
      ["inbox", "Van Der Berg-Whitmore"],
      ["thread", "wrong loaf"],
      ["rail", "Wholesale customer"],
      ["labels", "Christmas orders 2026"],
      ["labels-modal", "Christmas orders 2026"],
      ["onboarding", "Switch on an out-of-hours reply"],
      ["links", "opendoorbakery.co.uk"],
    ];
    for (const [view, text] of pairs) {
      expect(
        renderToStaticMarkup(views[view]!),
        `${view} rendered without "${text}" — its fixture is not reaching the component`,
      ).toContain(text);
    }
  });

  it("the awkward fixtures actually reach the markup", () => {
    /*
      The canary. Every assertion above is satisfied by a component that
      renders a wrapper and drops its rows, which is exactly the failure this
      file exists to catch — so at least one fixture value has to survive into
      the output.
    */
    const html = renderToStaticMarkup(views.inbox!);
    expect(html).toContain("Van Der Berg-Whitmore");
    expect(html).toContain("Christmas orders 2026");
  });

  it("writes the browser harness when asked", () => {
    if (!OUT) return; // CI: rendering above is the whole check
    mkdirSync(OUT, { recursive: true });
    for (const src of [
      "app/globals.css",
      "app/mail.css",
      "components/mail/onboarding.css",
    ]) {
      copyFileSync(join(process.cwd(), src), join(OUT, src.split("/").pop()!));
    }
    copyFileSync(join(process.cwd(), "tests/audit-probes.js"), join(OUT, "audit.js"));

    for (const [name, node] of Object.entries(views)) {
      writeFileSync(join(OUT, `${name}.html`), page(name, renderToStaticMarkup(node)), "utf8");
    }
  });
});
