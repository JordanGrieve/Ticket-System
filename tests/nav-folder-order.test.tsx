import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LabelWithCountDTO, MailCountsDTO } from "../components/mail/types";

/**
 * The folder list keeps ONE order, whatever is selected.
 *
 * ── THE BUG THIS PINS ──
 * The four look-up folders — Labeled, Snoozed, Archived, Trash — sit below a
 * More/Less row. The active one used to be lifted out of that group and
 * rendered above the row, so that collapsing the list could never hide the
 * thing explaining what you were looking at.
 *
 * Sound goal, wrong mechanism: the lift fired while the group was OPEN too.
 * Clicking Labeled, sitting in plain sight below Less, made it jump above
 * Less. Jordan, 11 Sep 2026: "when i click one below the Less it goes above
 * the Less, it should all stay where it is."
 *
 * Order is fixed now and visibility comes from the open state instead. That
 * is a rendering fact, and this reads the rendered markup for it: the index
 * of the More/Less row against the index of each look-up folder.
 */

const counts = {
  all: 7,
  unread: 2,
  awaiting: 1,
  inbox: 5,
  closed: 1,
  sent: 5,
  starred: 0,
  labeled: 5,
  snoozed: 0,
  archived: 1,
  trash: 4,
} satisfies MailCountsDTO;

const labels = [
  { id: 1, name: "Billing", color: "tag_b", colorHex: null, ticketCount: 2 },
] satisfies LabelWithCountDTO[];

/** Render the nav with one folder selected, and report where things landed. */
async function renderWith(folder: string) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    usePathname: () => "/inbox",
    useSearchParams: () => new URLSearchParams(folder ? `folder=${folder}` : ""),
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  }));
  vi.doMock("@/components/AuditedSignOutButton", () => ({
    default: () => null,
  }));

  const { default: MailNavShell } = await import("../components/mail/MailNavShell");
  const html = renderToStaticMarkup(
    <MailNavShell
      workspaceName="Open Door Bakery"
      userLabel="emma@opendoorbakery.co.uk"
      counts={counts}
      labels={labels}
      canPersonalise
      billing={null}
    />,
  );

  // The More/Less row is the only .pbm-folder--more in the column.
  const rowAt = html.indexOf("pbm-folder--more");
  expect(rowAt, "no More/Less row in the rendered nav").toBeGreaterThan(-1);

  const at = (label: string) => {
    const i = html.indexOf(`>${label}<`);
    expect(i, `${label} is not in the rendered nav`).toBeGreaterThan(-1);
    return i;
  };

  return { html, rowAt, at };
}

describe("the look-up folders stay below More/Less", () => {
  for (const folder of ["labeled", "snoozed", "archived", "trash"]) {
    it(`keeps every look-up folder below the row while ${folder} is selected`, async () => {
      const { rowAt, at } = await renderWith(folder);
      for (const label of ["Labeled", "Snoozed", "Archived", "Trash"]) {
        expect(
          at(label),
          `${label} rendered ABOVE the More/Less row while ${folder} was selected — the list reordered itself`,
        ).toBeGreaterThan(rowAt);
      }
    });
  }

  it("keeps the working folders above the row", async () => {
    const { rowAt, at } = await renderWith("inbox");
    for (const label of ["All mail", "Awaiting reply", "Open", "Closed", "Sent"]) {
      expect(at(label), `${label} belongs above the More/Less row`).toBeLessThan(rowAt);
    }
  });

  /*
   * The other half of the fix: order never changes, so the guarantee that the
   * active row is ON SCREEN has to come from the group being open instead.
   *
   * Asserted on `aria-expanded`, not on the word "More" or "Less". The
   * attribute is what a screen reader is told and what the collapse animation
   * keys off; the label is a consequence of it. A first version of this read
   * 200 characters after the row looking for the word and failed on markup
   * that was perfectly correct.
   */
  it("opens the group when a look-up folder is the one being viewed", async () => {
    const { html } = await renderWith("trash");
    const rowAt = html.indexOf("pbm-folder--more");
    expect(html.slice(rowAt, rowAt + 120)).toContain('aria-expanded="true"');
  });

  it("leaves the group shut on a working folder", async () => {
    const { html } = await renderWith("inbox");
    const rowAt = html.indexOf("pbm-folder--more");
    expect(html.slice(rowAt, rowAt + 120)).toContain('aria-expanded="false"');
  });
});
