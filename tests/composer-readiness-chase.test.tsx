// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import Composer from "../app/(dashboard)/newsletters/Composer";
import type { CampaignRowDTO } from "../app/(dashboard)/newsletters/Composer";

/**
 * The checklist above the Send button: where it sends you, and what it says
 * after you have done the thing.
 *
 * ── WHAT WENT WRONG ──
 * Jordan sent his first campaign on 14 Sep 2026 and called the process "a bit
 * confusing". Two reasons, both visible in one screenshot of his screen:
 *
 *   1. The Recipients card said "3 recipient rows created. 3 in total, all
 *      sitting at queued" and the panel DIRECTLY BENEATH IT said "Nobody is
 *      queued to receive this yet. Queue the recipients…". `health` was set
 *      in exactly one place — open() — so every action taken afterwards left
 *      the diagnosis describing a campaign that no longer existed. The half
 *      of the screen telling him what to do next was the wrong half.
 *
 *   2. Pressing a step scrolled to a card and stopped. On a long page that is
 *      arriving somewhere plausible with no idea which box was meant.
 *
 * ── WHY RENDERED CLICKS ──
 * Both are client state: one a refetch that never happened, one a derived
 * attribute. A source read can see neither. Same reasoning as
 * tests/composer-audience-count.test.tsx, which pins a sibling defect.
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

const campaign = {
  id: 11,
  name: "Saturday hours",
  subject: "We are open Saturdays",
  status: "draft",
  listId: null,
  listName: null,
  recipientCount: 0,
  updatedAtIso: "2026-09-14T17:00:00.000Z",
  sentAtIso: null,
} satisfies CampaignRowDTO;

const AUDIENCE = {
  recipientCount: 3,
  candidateCount: 3,
  skipped: {
    unconfirmed: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
    suppressed: 0,
    no_consent: 0,
  },
  skippedTotal: 0,
};

/** The stale diagnosis: what the server said BEFORE anybody queued anything. */
const HEALTH_BEFORE = {
  state: "blocked",
  remaining: 3,
  blockers: [
    {
      code: "no_recipients",
      message: "Nobody is queued to receive this yet.",
      blocking: true,
      operatorOnly: false,
    },
  ],
};

/** And after. The panel must end up showing THIS one. */
const HEALTH_AFTER = { state: "ready", remaining: 3, blockers: [] };

/**
 * Serves the campaign, and serves a DIFFERENT diagnosis after the queue POST.
 *
 * That is the whole point: a composer that never refetches passes a stub which
 * always returns the same health, however wrong it is. The stub changes its
 * answer so only a component that asks again can show the new one.
 */
function stubFetch() {
  const calls: string[] = [];
  let queued = false;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);

    if (method === "POST" && url.endsWith("/audience")) {
      queued = true;
      return new Response(JSON.stringify({ inserted: 3, total: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/audience")) {
      return new Response(JSON.stringify(AUDIENCE), {
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
            preheader: null,
            templateKey: "plain",
            body: "Hi {first_name},\n\nWe are open on Saturdays now.",
            heroImageUrl: null,
            heroImageAlt: null,
            products: [],
            scheduledAtIso: null,
            recipientCount: queued ? 3 : 0,
          },
          recipients: { queued: queued ? 3 : 0, sent: 0, failed: 0 },
          health: queued ? HEALTH_AFTER : HEALTH_BEFORE,
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
      workspaceName="AMORIA"
      legalName="AMORIA Ltd"
      postalAddress="12 High Street, Edinburgh, EH13 9LN"
      brandAccentHex={null}
      brandSignOff={null}
      appUrl="https://postbox.help"
      viewerEmail="amoria.lounge@gmail.com"
      recipientsPerSweep={75}
      welcomeEnabled
    />,
  );
}

const openCampaign = () =>
  fireEvent.click(screen.getByRole("button", { name: /Saturday hours/ }));

describe("the diagnosis keeps up with what you just did", () => {
  it("re-reads it after queueing, instead of leaving the old one on screen", async () => {
    const calls = stubFetch();
    show();
    openCampaign();

    await screen.findByText(/Nobody is queued to receive this yet/);

    fireEvent.click(screen.getByRole("button", { name: "Queue recipients" }));

    // The refetch itself. Asserted directly, because the defect WAS a request
    // that never happened — and a test that only watched the text would have
    // to decide whether "still there" meant stale or merely slow.
    await waitFor(() => {
      const afterQueue = calls.slice(calls.indexOf("POST /api/campaigns/11/audience"));
      expect(
        afterQueue.filter((c) => c === "GET /api/campaigns/11"),
        "nothing re-read the campaign after queueing, so the panel still describes the state before it",
      ).not.toHaveLength(0);
    });

    // And the stale sentence is gone from the screen.
    await waitFor(() => {
      expect(
        screen.queryByText(/Nobody is queued to receive this yet/),
        "the panel still says nobody is queued, directly under a line saying three rows were created",
      ).toBeNull();
    });
  });
});

describe("a step points at the thing it is asking for", () => {
  it("marks the Recipients card until the recipients are queued", async () => {
    stubFetch();
    show();
    openCampaign();

    const step = await screen.findByRole("button", { name: /Recipients queued/ });
    expect(
      document.querySelector("[data-chasing]"),
      "something was already marked before anybody asked",
    ).toBeNull();

    fireEvent.click(step);

    const marked = document.querySelector("[data-chasing]");
    expect(marked, "pressing the step marked nothing").not.toBeNull();
    // The RIGHT card: the one holding the control that satisfies the step.
    expect(marked!.querySelector("#nl-recipients")).not.toBeNull();
  });

  it("lets go once the step is satisfied", async () => {
    /*
     * The "until you do what it's asking" half. A mark that outlives its
     * reason is worse than none: it points at a finished job, and the next
     * real one is easier to ignore for it.
     */
    stubFetch();
    show();
    openCampaign();

    fireEvent.click(await screen.findByRole("button", { name: /Recipients queued/ }));
    expect(document.querySelector("[data-chasing]")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Queue recipients" }));

    await waitFor(() => {
      expect(
        document.querySelector("[data-chasing]"),
        "the Recipients card is still marked after its recipients were queued",
      ).toBeNull();
    });
  });
});

describe("a sent campaign offers a way forward", () => {
  /*
   * The lock on a sent campaign is right — the row is the record of what a
   * client's customers were told — but until 14 Sep 2026 it had no exit, so
   * "send that again with one word changed" meant retyping it. Jordan: "I
   * can't resend another email if I change it? Why is it locked?"
   *
   * Rendered rather than read as source: whether a button EXISTS at the moment
   * somebody needs it is client state, and the static harness cannot show it
   * because no campaign is open until one is clicked.
   */
  it("offers Duplicate once a campaign is open", async () => {
    stubFetch();
    show();
    // Nothing is open yet, so there is nothing to duplicate.
    expect(screen.queryByRole("button", { name: /^Duplicate/ })).toBeNull();

    openCampaign();
    await screen.findByRole("button", { name: /Duplicate Saturday hours/ });
  });

  it("asks the SERVER for the copy", async () => {
    /*
     * Not "post the fields on screen". The open campaign may carry unsaved
     * edits, so copying the form would duplicate something that was never
     * sent — and the server builds the copy through draftColumns, whose
     * `satisfies` is what stops a field being dropped. A client-side copy
     * would have to be remembered to update, and it would not be.
     */
    const calls = stubFetch();
    show();
    openCampaign();

    fireEvent.click(await screen.findByRole("button", { name: /Duplicate/ }));

    await waitFor(() => {
      expect(
        calls,
        "the Duplicate button did not ask the server for a copy",
      ).toContain("POST /api/campaigns/11/duplicate");
    });
  });
});
