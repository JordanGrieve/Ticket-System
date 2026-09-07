import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
  ── WHY THIS FILE EXISTS WHEN a11y-public-pages.test.tsx ALREADY DOES ──

  That file asserts STRUCTURE from markup: an h1 exists, links have names,
  inputs have labels. It says so itself, and lists what it cannot reach --
  "anything needing layout: overlap, reflow at zoom, tap target sizes".

  Those are exactly the criteria that were failing. Structure is decided by the
  markup; reflow, contrast and target size are decided by the STYLESHEET at a
  given width, and neither can be read off the other.

  A browser could measure them, except that these are the routes where the
  skeleton trap bites hardest: /privacy is 80KB of markup that renders as one
  placeholder bar in a driven pane, because React will not commit a Suspense
  boundary while the document is hidden. Measured on 7 Sep 2026 it reported 28
  visible elements and 7 characters of text -- and came back clean, because a
  placeholder has no text to fail a contrast check.

  So the public pages get the same treatment as the five dashboard harnesses:
  rendered to static HTML, dressed in the real stylesheets, driven with the
  real probes. Static HTML has no Suspense boundary to commit, which is what
  makes it measurable at all.

    PUBLIC_HARNESS_OUT=$PWD/public/_ph npx vitest run tests/public-views-render
*/

// Hoisted: vi.mock's factory runs before every const in the file.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

/*
  The homepage was previously written off as unrenderable -- "app/page.tsx
  calls Clerk's auth(), which pulls `server-only` from inside node_modules
  where this project's vitest alias does not reach".

  The diagnosis was right and the conclusion did not follow. vi.mock replaces
  the WHOLE module, so the real @clerk/nextjs/server is never loaded and never
  gets the chance to import server-only. Nothing needs aliasing.

  That matters more than the other four put together: the homepage is the most
  visited page the product has, and it was the only one no automated check
  could see.
*/
vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: async () => null,
}));

/*
  redirect() THROWS rather than returning, so a fixture that put a page into a
  state it redirects out of fails loudly instead of writing a blank harness
  page that a later sweep would report as clean.

  The router hooks are here because /no-access wraps itself in Clerk's
  provider, which calls useRouter during render.
*/
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  },
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/no-access",
  useSearchParams: () => new URLSearchParams(),
}));

/*
  /no-access is reached by a SIGNED-IN visitor who has neither a workspace nor
  an invite, so the fixture has to be that exact shape: an authenticated viewer
  who is not an admin and owns nothing. Any other combination redirects, and
  the redirect stub above turns that into a loud failure rather than a blank
  page -- which is the point of stubbing it that way.
*/
vi.mock("@/lib/viewer", () => ({
  resolveViewer: async () => ({ isAdmin: false, workspace: null }),
}));

import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import Home from "../app/page";
import Pricing from "../app/pricing/page";
import Contact from "../app/contact/page";
import Privacy from "../app/(legal)/privacy/page";
import Terms from "../app/(legal)/terms/page";
import LegalLayout from "../app/(legal)/layout";
import NoAccess from "../app/no-access/page";
import NotFound from "../app/not-found";
import SubscribeLayout from "../app/s/layout";
import CheckInbox from "../app/s/check/page";
import SubscribeDone from "../app/s/done/page";
import UnsubscribeLayout from "../app/u/layout";
import UnsubscribeDone from "../app/u/[token]/done/page";

const OUT = process.env.PUBLIC_HARNESS_OUT;

/** Every stylesheet the public routes import, plus the probes. */
const SHEETS = [
  "app/globals.css",
  "app/home.css",
  "app/pricing/pricing.css",
  "app/contact/contact.css",
  "app/s/subscribe.css",
  "app/u/unsubscribe.css",
  "components/marketing/feature-bento.css",
  "components/marketing/product-shot.css",
  "components/marketing/theme-row.css",
];

/*
  The <head> mirrors what the product does, and the reasons are not cosmetic.

  THEME BEFORE FIRST PAINT. Flipping data-theme on a live page produced
  impossible readings -- a card insisting on the dark surface while its own
  computed surface was #ffffff. ThemeApplier sets it in the document head in
  the real app, so the harness does too, from ?theme=.

  NO NEXT/FONT. next/font injects a class and a @font-face at build time,
  neither of which exists here, so the pages would fall back to Times and every
  measurement would be against the wrong metrics. The stack is restated
  literally to match what next/font resolves to.
*/
function page(title: string, body: string, sheets = SHEETS) {
  const links = sheets
    .map((s) => `<link rel="stylesheet" href="./${s.split("/").pop()}">`)
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>
  var t = new URLSearchParams(location.search).get("theme");
  if (t) document.documentElement.setAttribute("data-theme", t);
</script>
${links}
<style>
  body { margin: 0; font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif; }
</style>
</head><body>${body}
<script src="./audit.js"></script></body></html>`;
}

type Rendered = [name: string, html: string];

const rendered: Rendered[] = [];

/*
  Some of these pages are async server components and some are plain sync
  functions, which is a detail of each page rather than something this file
  gets to decide.

  The first draft papered over it with `as () => Promise<JSX.Element>` on the
  sync ones, and tsc rejected the cast outright — correctly, since Element and
  Promise<Element> do not overlap. Casting is what AGENTS.md warns about, and
  the compiler had the right answer: `await` accepts both, so nothing needs
  asserting. Widening the PARAMETER is honest where casting the value is not.
*/
async function render(
  node: React.JSX.Element | Promise<React.JSX.Element>,
): Promise<string> {
  return renderToStaticMarkup(await node);
}

function record(name: string, html: string) {
  rendered.push([name, html]);
  return html;
}

describe("the pages a stranger can reach render, and can be measured", () => {
  it("the homepage, with sign-up closed — the state that ships today", async () => {
    authMock.mockResolvedValue({ userId: null });
    const html = renderToStaticMarkup(await Home());
    record("home", html);
    // Canaries: a page that lost its hero would still be long enough.
    expect(html).toContain("Postbox");
    expect(html.length).toBeGreaterThan(4000);
    // #newsletters is load-bearing for the open SES production-access case;
    // app/page.tsx says so in terms. Worth failing a test over.
    expect(html).toContain('id="newsletters"');
  });

  it("pricing", async () => {
    const html = record("pricing", await render(Pricing()));
    expect(html.length).toBeGreaterThan(2000);
  });

  it("contact", async () => {
    const html = record("contact", await render(Contact()));
    expect(html.length).toBeGreaterThan(1000);
  });

  it("privacy and terms, inside the layout that gives them their <main>", async () => {
    for (const [name, Page] of [
      ["privacy", Privacy],
      ["terms", Terms],
    ] as const) {
      const html = record(
        name,
        renderToStaticMarkup(<LegalLayout>{await Page()}</LegalLayout>),
      );
      expect(html.length).toBeGreaterThan(3000);
    }
  });

  /*
    The pages a CLIENT'S CUSTOMER sees — not our user, and the only Postbox
    screens most of them will ever look at.

    They matter more than their size suggests. Somebody confirming a bakery
    newsletter has no account, no support channel and no reason to persevere:
    if the page is unreadable they simply leave, and the client loses the
    subscriber rather than us. They are also the only surfaces here reached
    from an email client, so they get opened on a phone far more than anything
    else in the product.
  */
  it("the subscribe and unsubscribe pages a client's customer lands on", async () => {
    record(
      "s-check",
      renderToStaticMarkup(
        <SubscribeLayout>
          {await CheckInbox({ searchParams: Promise.resolve({}) })}
        </SubscribeLayout>,
      ),
    );
    record(
      "s-done",
      renderToStaticMarkup(<SubscribeLayout>{await SubscribeDone()}</SubscribeLayout>),
    );
    record(
      "u-done",
      renderToStaticMarkup(<UnsubscribeLayout>{await UnsubscribeDone()}</UnsubscribeLayout>),
    );
    for (const name of ["s-check", "s-done", "u-done"]) {
      expect(rendered.find(([n]) => n === name)![1].length).toBeGreaterThan(300);
    }
  });

  it("the two dead ends a signed-in stranger can hit", async () => {
    record("no-access", await render(NoAccess()));
    record("not-found", await render(<NotFound />));
    expect(rendered.find(([n]) => n === "not-found")![1].length).toBeGreaterThan(300);
  });

  it("writes the browser harness when asked", () => {
    if (!OUT) {
      // Not a skip: the renders above are the CI assertion, and they ran.
      expect(rendered.length).toBeGreaterThanOrEqual(10);
      return;
    }
    mkdirSync(OUT, { recursive: true });
    for (const src of SHEETS) {
      copyFileSync(join(process.cwd(), src), join(OUT, src.split("/").pop()!));
    }
    copyFileSync(join(process.cwd(), "tests/audit-probes.js"), join(OUT, "audit.js"));
    for (const [name, html] of rendered) {
      writeFileSync(join(OUT, `${name}.html`), page(name, html), "utf8");
    }
    expect(rendered.length).toBeGreaterThanOrEqual(10);
  });
});
