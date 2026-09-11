import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// See tests/mail-views-render.test.tsx for why this stand-in exists.
vi.mock("next/navigation", () => ({
  usePathname: () => "/newsletters",
  useSearchParams: () => new URLSearchParams(""),
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
import Composer from "../app/(dashboard)/newsletters/Composer";
import type { CampaignRowDTO } from "../app/(dashboard)/newsletters/Composer";

/**
 * The newsletter composer renders.
 *
 * The board goal is "Open Door Bakery sends one real newsletter", and this is
 * the screen that has to happen on. It is also the most stateful thing in the
 * product, and it had never been rendered outside a browser session with a
 * login and a workspace.
 *
 *   NEWSLETTER_HARNESS_OUT=$PWD/public/_nh npx vitest run tests/newsletter-views-render
 *
 * ── THE FIXTURE IS THE BLOCKED WORKSPACE ──
 * postalAddress is null, which is the state that REFUSES a send: CAN-SPAM
 * requires a physical postal address in every commercial message, and
 * lib/newsletter.ts treats null-or-blank as a hard stop rather than rendering
 * an empty line. So the interesting fixture is not a campaign ready to go out,
 * it is the one that cannot, with the warning that explains why — which is
 * exactly the state Open Door Bakery is in.
 */

const OUT = process.env.NEWSLETTER_HARNESS_OUT;

const iso = (h: number) => new Date(Date.UTC(2026, 8, 6, 11, 20) - h * 3600_000).toISOString();

const campaigns = [
  {
    id: 1,
    name: "Christmas orders are open",
    subject: "Christmas orders are open — order by the 12th",
    status: "draft",
    listId: 1,
    listName: "Everyone",
    recipientCount: 118,
    updatedAtIso: iso(4),
    sentAtIso: null,
  },
  {
    // A long name with no list chosen and nothing to send to.
    id: 2,
    name: "A newsletter with a considerably longer name than the column expects",
    subject: "",
    status: "draft",
    listId: null,
    listName: null,
    recipientCount: 0,
    updatedAtIso: iso(300),
    sentAtIso: null,
  },
  {
    id: 3,
    name: "September specials",
    subject: "This month at the bakery",
    status: "sent",
    listId: 1,
    listName: "Everyone",
    recipientCount: 104,
    updatedAtIso: iso(700),
    sentAtIso: iso(700),
  },
] satisfies CampaignRowDTO[];

const views: Record<string, React.ReactElement> = {
  // The blocked state: no postal address, so a send is refused.
  composer: (
    <Composer
      initialCampaigns={campaigns}
      workspaceName="Open Door Bakery"
      legalName={null}
      postalAddress={null}
      brandAccentHex={null}
      brandSignOff={null}
      appUrl="https://postbox.help"
      viewerEmail="hello@opendoorbakery.co.uk"
      recipientsPerSweep={250}
    />
  ),
  // Everything supplied, so the refusal copy is out of the way.
  "composer-ready": (
    <Composer
      initialCampaigns={campaigns}
      workspaceName="Open Door Bakery"
      legalName="Open Door Bakery Ltd"
      postalAddress={"12 Mill Lane\nStroud\nGL5 1AB"}
      brandAccentHex="#b5651d"
      brandSignOff="Thanks, Emma"
      appUrl="https://postbox.help"
      viewerEmail="hello@opendoorbakery.co.uk"
      recipientsPerSweep={250}
    />
  ),
  "composer-empty": (
    <Composer
      initialCampaigns={[]}
      workspaceName="Open Door Bakery"
      legalName={null}
      postalAddress={null}
      brandAccentHex={null}
      brandSignOff={null}
      appUrl="https://postbox.help"
      viewerEmail="hello@opendoorbakery.co.uk"
      recipientsPerSweep={250}
    />
  ),
};

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
<link rel="stylesheet" href="./newsletter.css">
</head><body><div class="pb-shell pbm"><div class="pbm-page pb-scroll">${body}</div></div>
<script src="./audit.js"></script></body></html>`;
}

describe("the newsletter composer renders", () => {
  for (const [name, node] of Object.entries(views)) {
    it(name, () => {
      const html = renderToStaticMarkup(node);
      expect(html.length, `${name} rendered nothing`).toBeGreaterThan(400);
    });
  }

  it("the campaigns reach the markup", () => {
    // The canary: a list that silently dropped its rows would pass every
    // length assertion above.
    const html = renderToStaticMarkup(views.composer!);
    expect(html).toContain("Christmas orders are open");
  });

  it("writes the browser harness when asked", () => {
    if (!OUT) return;
    mkdirSync(OUT, { recursive: true });
    for (const src of ["app/globals.css", "app/mail.css", "app/newsletter.css"]) {
      copyFileSync(join(process.cwd(), src), join(OUT, src.split("/").pop()!));
    }
    copyFileSync(join(process.cwd(), "tests/audit-probes.js"), join(OUT, "audit.js"));
    for (const [name, node] of Object.entries(views)) {
      writeFileSync(join(OUT, `${name}.html`), page(name, renderToStaticMarkup(node)), "utf8");
    }
  });
});
