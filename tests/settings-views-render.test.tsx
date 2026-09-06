import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Same stand-in as tests/mail-views-render.test.tsx — see the note there.
// /settings is the route these views are written for, and SettingsTabs uses
// the pathname to decide which tab is current.
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
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
import ThemePicker from "../app/(dashboard)/settings/ThemePicker";
import SettingsTabs from "../app/(dashboard)/settings/SettingsTabs";
import SenderIdentityForm from "../app/(dashboard)/settings/SenderIdentityForm";
import NewsletterBrandForm from "../app/(dashboard)/settings/NewsletterBrandForm";
import AutoReplySettings from "../app/(dashboard)/settings/auto-reply/AutoReplySettings";
import InstallView from "../components/InstallView";
import { DEFAULT_CONFIG } from "../lib/auto-reply";

/**
 * Every settings view renders.
 *
 * The third of these harnesses, after the admin console and the mail views,
 * and app/settings.css is the largest stylesheet in the product — 2,454 lines
 * behind a login, which is a lot of surface nothing was rendering.
 *
 * Set SETTINGS_HARNESS_OUT to write the browser harness:
 *
 *   SETTINGS_HARNESS_OUT=$PWD/public/_sh npx vitest run tests/settings-views-render
 *
 * then open /_sh/general.html?theme=slate and call __selftest(), __overflow(),
 * __contrast() and __targets(). The theme is set before the first paint rather
 * than switched afterwards — see the note in tests/mail-views-render.test.tsx
 * about why switching at runtime produced numbers that were not true.
 *
 * ── THE FIXTURES ARE THE UNCONFIGURED WORKSPACE ──
 * Nulls where a real workspace has nulls: no legal name, no postal address, no
 * brand accent. That is the state Open Door Bakery is actually in, it is the
 * state the empty-state and warning copy is written for, and it is the one a
 * fixture full of tidy values would never show.
 */

const OUT = process.env.SETTINGS_HARNESS_OUT;

const views: Record<string, React.ReactElement> = {
  tabs: <SettingsTabs />,
  themes: <ThemePicker value="dark" />,
  // Nothing filled in — the CAN-SPAM fields a send is gated on.
  "sender-empty": (
    <SenderIdentityForm legalName={null} postalAddress={null} workspaceName="Open Door Bakery" />
  ),
  "sender-filled": (
    <SenderIdentityForm
      legalName="Open Door Bakery Ltd"
      postalAddress={"12 Mill Lane\nStroud\nGloucestershire\nGL5 1AB"}
      workspaceName="Open Door Bakery"
    />
  ),
  brand: (
    <NewsletterBrandForm brandAccentHex={null} brandSignOff={null} workspaceName="Open Door Bakery" />
  ),
  "auto-reply-off": (
    <AutoReplySettings initialConfig={DEFAULT_CONFIG} configured={false} workspaceName="Open Door Bakery" />
  ),
  "auto-reply-on": (
    <AutoReplySettings
      initialConfig={{ ...DEFAULT_CONFIG, enabled: true, scheduleMode: "business_hours", delay: "5min" }}
      configured
      workspaceName="Open Door Bakery"
    />
  ),
  install: (
    <InstallView
      apiKey="cli_abc123def456"
      inboundEmail="bakery@inbound.postbox.help"
      replyFrom={'"Open Door Bakery" <replies@postbox.help>'}
      workspaceName="Open Door Bakery"
      appUrl="https://postbox.help"
      subscribeEndpoint="https://postbox.help/api/subscribe/cli_abc123def456"
      hostedSignupUrl="https://postbox.help/s/cli_abc123def456"
      honeypotFields={["company_website", "fax_number"]}
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
<link rel="stylesheet" href="./settings.css">
</head><body><div class="pbm-page pb-scroll"><div class="stg-wrap">${body}</div></div>
<script src="./audit.js"></script></body></html>`;
}

describe("every settings view renders", () => {
  for (const [name, node] of Object.entries(views)) {
    it(name, () => {
      const html = renderToStaticMarkup(node);
      expect(html.length, `${name} rendered nothing`).toBeGreaterThan(200);
    });
  }

  it("the unconfigured state actually reaches the markup", () => {
    // The canary: a form that dropped its warning would satisfy every length
    // assertion above, and the warning is the whole reason this fixture is
    // the empty one.
    const html = renderToStaticMarkup(views["sender-empty"]!);
    expect(html).toContain("Open Door Bakery");
    expect(html.toLowerCase()).toMatch(/postal|address/);
  });

  it("writes the browser harness when asked", () => {
    if (!OUT) return;
    mkdirSync(OUT, { recursive: true });
    for (const src of ["app/globals.css", "app/mail.css", "app/settings.css"]) {
      copyFileSync(join(process.cwd(), src), join(OUT, src.split("/").pop()!));
    }
    copyFileSync(join(process.cwd(), "tests/audit-probes.js"), join(OUT, "audit.js"));
    for (const [name, node] of Object.entries(views)) {
      writeFileSync(join(OUT, `${name}.html`), page(name, renderToStaticMarkup(node)), "utf8");
    }
  });
});
