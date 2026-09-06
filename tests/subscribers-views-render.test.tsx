import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/*
  ── AN ASYNC SERVER COMPONENT IS STILL JUST AN ASYNC FUNCTION ──
  The other harnesses render client components, which take props. This page
  does its own fetching: resolveViewer() for the tenancy filter, then two
  queries. There is no presentational component to hand fixtures to.

  It does not need one. `await SubscribersPage({ searchParams })` returns the
  element tree, and only the DATA LAYER has to be stood in for — the page's own
  logic (status parsing, page clamping, empty states, the tenancy filter it
  passes down) all runs for real. Refactoring working code to make it testable
  would have been the wrong trade when awaiting it does the job.

  The mocks are the module boundary the page already draws: ./queries owns
  every SQL statement on this route, and lib/viewer owns who is asking.
*/

// vi.mock is hoisted above every const in the file, so the stand-ins have to
// be created inside vi.hoisted() or the factory below closes over a binding
// that does not exist yet.
const { listSubscriberPage, statusCounts } = vi.hoisted(() => ({
  listSubscriberPage: vi.fn(),
  statusCounts: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({
  resolveViewer: async () => ({
    isAdmin: false,
    workspace: { id: 3, name: "Open Door Bakery", accent: "terracotta" },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    // A redirect here would mean the fixture said "no workspace", which is not
    // the state under test. Throwing beats silently rendering nothing.
    throw new Error(`unexpected redirect to ${to}`);
  },
}));

vi.mock("../app/(dashboard)/subscribers/queries", async () => {
  const real = await vi.importActual<typeof import("../app/(dashboard)/subscribers/queries")>(
    "../app/(dashboard)/subscribers/queries",
  );
  return {
    // parseStatus, SUBSCRIBERS_PAGE_SIZE and the status union stay REAL — they
    // are logic, not IO, and standing them in would test the stand-in.
    ...real,
    listSubscriberPage,
    statusCounts,
  };
});

import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import SubscribersPage from "../app/(dashboard)/subscribers/page";
import type { SubscriberRow, StatusCounts } from "../app/(dashboard)/subscribers/queries";

const at = (h: number) => new Date(Date.UTC(2026, 8, 6, 11, 20) - h * 3600_000);

/**
 * The subscribers screen — the last tenant surface with no coverage.
 *
 *   SUBSCRIBERS_HARNESS_OUT=$PWD/public/_bh npx vitest run tests/subscribers-views-render
 *
 * ── THE ROWS ARE THE AWKWARD ONES ──
 * A very long address, a subscriber with no name, one with no consent record
 * at all (the state the audience selector refuses to mail), and an
 * unsubscribed row. Consent is the column this screen exists to answer
 * questions about, so a fixture where every row has tidy consent would miss
 * the only rows anybody opens this page to find.
 */

const rows = [
  {
    id: 1,
    email: "margarethe.vandenberg-whitmore@averylongdomainname.example.co.uk",
    name: "Margarethe Van Der Berg-Whitmore",
    status: "subscribed",
    source: "website form",
    subscribedAt: at(400),
    consentMethod: "signup_form",
    consentAt: at(400),
  },
  {
    id: 2,
    email: "hello@example.com",
    name: null,
    status: "subscribed",
    source: null,
    subscribedAt: at(90),
    // No consent recorded — selectAudience will not mail this one.
    consentMethod: null,
    consentAt: null,
  },
  {
    id: 3,
    email: "someone.else@example.org",
    name: "Someone Else",
    status: "unsubscribed",
    source: "import",
    subscribedAt: at(2000),
    consentMethod: "import",
    consentAt: at(2000),
  },
] satisfies SubscriberRow[];

const counts = { all: 118, subscribed: 104, unsubscribed: 12, bounced: 2, complained: 0 } satisfies StatusCounts;

async function render(
  params: { status?: string; page?: string },
  data: { rows: unknown[]; hasMore: boolean },
) {
  listSubscriberPage.mockResolvedValue(data);
  statusCounts.mockResolvedValue(counts);
  const el = await SubscribersPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(el);
}

const OUT = process.env.SUBSCRIBERS_HARNESS_OUT;

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>
  var t = new URLSearchParams(location.search).get("theme");
  if (t) document.documentElement.setAttribute("data-theme", t);
</script>
<link rel="stylesheet" href="./globals.css">
<link rel="stylesheet" href="./mail.css">
<link rel="stylesheet" href="./subscribers.css">
</head><body><div class="pb-shell pbm"><div class="pbm-page pb-scroll">${body}</div></div>
<script src="./audit.js"></script></body></html>`;
}

describe("the subscribers screen renders", () => {
  it("a full page of subscribers", async () => {
    const html = await render({}, { rows, hasMore: true });
    expect(html.length).toBeGreaterThan(400);
    // The canary: a page that dropped its rows would still be long enough.
    expect(html).toContain("margarethe.vandenberg-whitmore@");
  });

  it("an empty workspace", async () => {
    const html = await render({}, { rows: [], hasMore: false });
    expect(html.length).toBeGreaterThan(200);
  });

  it("a status filter the page has to validate", async () => {
    // parseStatus is the real one, so this exercises the actual validation
    // rather than a stand-in that always agrees.
    const html = await render({ status: "unsubscribed" }, { rows, hasMore: false });
    expect(html.length).toBeGreaterThan(400);
  });

  it("a junk status and a junk page number are survived", async () => {
    const html = await render({ status: "'; drop table", page: "-4" }, { rows, hasMore: false });
    expect(html.length).toBeGreaterThan(400);
    // Clamped to page 1, and the filter fell back to "all".
    expect(listSubscriberPage).toHaveBeenLastCalledWith(3, null, 1);
  });

  it("writes the browser harness when asked", async () => {
    if (!OUT) return;
    mkdirSync(OUT, { recursive: true });
    for (const src of ["app/globals.css", "app/mail.css", "app/subscribers.css"]) {
      copyFileSync(join(process.cwd(), src), join(OUT, src.split("/").pop()!));
    }
    copyFileSync(join(process.cwd(), "tests/audit-probes.js"), join(OUT, "audit.js"));
    writeFileSync(
      join(OUT, "subscribers.html"),
      page("subscribers", await render({}, { rows, hasMore: true })),
      "utf8",
    );
    writeFileSync(
      join(OUT, "subscribers-empty.html"),
      page("subscribers-empty", await render({}, { rows: [], hasMore: false })),
      "utf8",
    );
  });
});
