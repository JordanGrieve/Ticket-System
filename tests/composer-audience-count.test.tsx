// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import Composer from "../app/(dashboard)/newsletters/Composer";
import type { CampaignRowDTO } from "../app/(dashboard)/newsletters/Composer";

/**
 * A campaign counts its audience and can be queued — WITHOUT a list.
 *
 * ── THE BUG THIS PINS ──
 *
 * Lists were retired on the way to the workspace-wide audience, and four
 * places in the composer went on keying off `campaigns.list_id`. Every
 * campaign created since has that column NULL, so together they made every
 * campaign in the product unsendable:
 *
 *   1. `countKey` was nulled whenever `savedListId === null`, so the audience
 *      request was never made for any campaign at all;
 *   2. the derived `audience` state short-circuited to `no_list`, which
 *      rendered "Nobody has confirmed a subscription yet." to workspaces that
 *      had confirmed subscribers;
 *   3. "Queue recipients" carried `savedListId === null` in its `disabled`
 *      expression, so the button could never be pressed;
 *   4. the help text under it said "Choose an audience list and save" —
 *      an instruction to use a picker the product no longer has.
 *
 * Found on 11 Sep 2026 while trying to run a campaign end to end through the
 * new Resend deliverer. Nothing in the repository could see it: the endpoint
 * was right (`previewAudience` ignores list_id and calls `workspaceAudience`),
 * the arming predicate had already been fixed
 * (tests/campaign-arming.test.ts), and the render harness's own fixtures
 * carried `listId: 1` — a state the database can no longer produce — so the
 * one fixture that would have shown it was never the selected one.
 *
 * ── WHY A RENDERED CLICK AND NOT A SOURCE READ ──
 *
 * Because the defect was in derived client state and a `disabled` expression,
 * which is exactly what a rendered click can see and a source read cannot
 * judge. The sibling guards go the other way for the opposite reason: arming
 * is one UPDATE whose WHERE is the whole argument, so it is read as source.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/newsletters",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A saved draft as the database actually holds one: no list, because there are
 * no lists. A fixture with `listId: 1` here would pass against the very bug
 * this file exists to catch.
 */
const campaign = {
  id: 11,
  name: "Resend switchover proof",
  subject: "Saturday opening hours at the bakery",
  status: "draft",
  listId: null,
  listName: null,
  recipientCount: 0,
  updatedAtIso: "2026-09-11T20:00:00.000Z",
  sentAtIso: null,
} satisfies CampaignRowDTO;

/** What GET /api/campaigns/:id/audience really returns for this workspace. */
const AUDIENCE = {
  recipientCount: 1,
  candidateCount: 1,
  skipped: { unconfirmed: 0, unsubscribed: 0, bounced: 0, complained: 0, suppressed: 0, no_consent: 0 },
  skippedTotal: 0,
};

/**
 * Stub the two endpoints the composer reaches on selection.
 *
 * Records every URL so a test can assert the audience request was MADE — the
 * defect was a request that never happened, and a test that only looked at the
 * rendered number would have read "Counting…" forever and had to decide that
 * was a failure. Asserting on the call is the direct statement.
 */
function stubFetch(audience: unknown = AUDIENCE) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/audience")) {
      return new Response(JSON.stringify(audience), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === `/api/campaigns/${campaign.id}`) {
      return new Response(
        JSON.stringify({
          campaign: {
            ...campaign,
            workspaceId: 25,
            preheader: "We are open Saturdays from 8am",
            templateKey: "plain",
            body: "Hi {first_name},\n\nWe are open on Saturdays now.",
            heroImageUrl: null,
            heroImageAlt: null,
            products: [],
            scheduledAtIso: null,
          },
          recipients: { queued: 0, sent: 0, failed: 0 },
          health: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function show() {
  render(
    <Composer
      initialCampaigns={[campaign]}
      workspaceName="E2E Test Bakery"
      legalName="E2E Test Bakery Ltd"
      postalAddress="4 Test Lane, Harrogate, HG1 2BB"
      brandAccentHex={null}
      brandSignOff={null}
      appUrl="https://postbox.help"
      viewerEmail="jordangrieve.dev@gmail.com"
      recipientsPerSweep={75}
    />,
  );
}

const row = () => screen.getByRole("button", { name: /Resend switchover proof/ });
const queueButton = () => screen.getByRole("button", { name: "Queue recipients" });

describe("selecting a saved campaign", () => {
  it("loads it into the composer", async () => {
    // The label is "Subject line", not "Subject".
    stubFetch();
    show();
    fireEvent.click(row());
    await waitFor(() => {
      expect((screen.getByLabelText("Subject line") as HTMLInputElement).value).toBe(
        "Saturday opening hours at the bakery",
      );
    });
  });
});

describe("a campaign with no list — which is every campaign", () => {
  it("REQUESTS its audience count", async () => {
    const calls = stubFetch();
    show();
    fireEvent.click(row());
    await waitFor(() => {
      expect(
        calls.some((c) => c === `GET /api/campaigns/${campaign.id}/audience`),
        `the audience was never counted; calls were ${JSON.stringify(calls)}`,
      ).toBe(true);
    });
  });

  it("shows the number it was given", async () => {
    stubFetch();
    show();
    fireEvent.click(row());
    // The readout renders the count; "Nobody has confirmed a subscription yet"
    // is what it said for every campaign before this was fixed.
    await waitFor(() => {
      expect(document.body.textContent).not.toMatch(
        /Nobody has confirmed a subscription yet/i,
      );
    });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/\b1\b/);
    });
  });

  it("lets Queue recipients be pressed", async () => {
    stubFetch();
    show();
    fireEvent.click(row());
    await waitFor(() => {
      expect(
        (queueButton() as HTMLButtonElement).disabled,
        "Queue recipients is disabled, so the campaign can never be armed",
      ).toBe(false);
    });
  });

  it("does NOT tell the client to choose a list", async () => {
    // There is no picker to choose one in. An instruction a client cannot
    // follow is worse than no instruction.
    stubFetch();
    show();
    fireEvent.click(row());
    await waitFor(() => {
      expect((screen.getByLabelText("Subject line") as HTMLInputElement).value).toBe(
        "Saturday opening hours at the bakery",
      );
    });
    expect(document.body.textContent).not.toMatch(/audience list/i);
  });
});

describe("the guards that must survive this change", () => {
  it("still refuses to queue an UNSAVED draft", async () => {
    // `savedId === null` is the clause that had to stay. Queueing a draft the
    // server has never seen would materialise an audience for nothing.
    stubFetch();
    show();
    // No selection: the composer opens on the empty new-campaign form.
    expect((queueButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("still refuses to queue a draft with unsaved edits", async () => {
    stubFetch();
    show();
    fireEvent.click(row());
    await waitFor(() => {
      expect((queueButton() as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.change(screen.getByLabelText("Subject line"), {
      target: { value: "Something else entirely" },
    });
    // Dirty now: queueing would build an audience for a body the server does
    // not have.
    expect((queueButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
