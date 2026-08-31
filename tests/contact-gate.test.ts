import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The console has to say when nobody can contact Postbox.
 *
 * ── THE FAILURE THIS EXISTS FOR, FOUND LIVE ──
 * postbox.help/contact currently renders "this form isn't connected yet"
 * because POSTBOX_CONTACT_KEY is unset in production. Every "Get in touch"
 * button on the pricing page — one per plan, plus the nav — points at it. So
 * the marketing site advertises three plans and cannot take a single enquiry.
 *
 * What makes it able to sit like that is the honesty of the page itself: it
 * tells the VISITOR plainly that the form is dead, which is the right thing to
 * tell them, and the exact reason nobody on this side finds out. There is no
 * error, no failed request, and no missing enquiry to notice — enquiries have
 * nowhere to be lost from.
 *
 * It is the same shape as the six weeks Open Door Bakery spent behind a broken
 * contact form, which is why "Needs a look" exists on the accounts tab.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const sections = read("app", "(admin)", "admin", "sections.tsx");
const page = read("app", "(admin)", "admin", "page.tsx");
const contact = read("app", "contact", "page.tsx");

describe("the contact key is an environment gate like the others", () => {
  it("is declared on ConsoleGates", () => {
    expect(sections).toContain("contactFormLive: boolean;");
  });

  it("is read from POSTBOX_CONTACT_KEY, not from a second source of truth", () => {
    // The page must agree with lib/config.ts about what "set" means — trimmed,
    // and empty-is-null. Reading process.env here directly would let the
    // console call it configured while the contact page called it missing.
    expect(page).toContain("contactFormLive: Boolean(POSTBOX_CONTACT_KEY)");
    expect(page).toContain('from "@/lib/config"');
  });

  it("warns on the overview when it is not set", () => {
    expect(sections).toContain("!gates.contactFormLive");
    expect(sections).toContain("Nobody can contact Postbox right now");
  });

  it("puts the warning ABOVE the numbers it does not qualify", () => {
    /*
     * Every other gate warning sits beside the figure it explains. This one
     * explains no figure — it says the front door is locked — so it goes
     * first, before KpiGrid, rather than being filed among the caveats.
     */
    const start = sections.indexOf("export function OverviewSection");
    const body = sections.slice(start, sections.indexOf("\nexport function", start + 10));
    expect(body.indexOf("!gates.contactFormLive")).toBeLessThan(
      body.indexOf("<KpiGrid"),
    );
  });

  it("tells the operator how to fix it, not just that it is broken", () => {
    // A warning with no next step gets read once and skipped afterwards.
    expect(sections).toMatch(/create a workspace here for Postbox itself/i);
  });
});

describe("the contact page stays honest when the key is missing", () => {
  it("renders a form only when the key is set", () => {
    expect(contact).toMatch(/POSTBOX_CONTACT_KEY \?/);
  });

  it("says so plainly rather than showing a form that goes nowhere", () => {
    // A form that silently drops a message is worse than no form: the sender
    // waits for a reply that was never coming.
    expect(contact).toMatch(/isn&rsquo;t connected yet/);
  });

  it("is rendered per request, so setting the key needs no rebuild", () => {
    // Statically prerendered, this would bake in whatever the key was at BUILD
    // time — so somebody could set it, see no change, and have nothing to
    // explain why.
    expect(contact).toContain('export const dynamic = "force-dynamic"');
  });
});
