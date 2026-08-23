import type { CampaignStatus, RecipientStatus } from "../db/schema";

/**
 * Why isn't this campaign moving?
 *
 * ── WHY THIS EXISTS ──
 * Every failure in the send pipeline currently looks the same from the one
 * seat that matters. A missing CRON_SECRET, an unset CAMPAIGN_FROM_ADDRESS, a
 * blank postal address and a genuinely quiet week all render to the client as
 * a campaign that says "Sending", forever. The entire explanation lives in a
 * `console.warn` or a red GitHub Actions run that only the operator can see.
 *
 * That is the same failure as the six-week contact-form outage and the
 * lib/config.ts inbox outage: in neither case was the bug the problem. The
 * problem was that nothing surfaced it.
 *
 * ── PURE ──
 * No database, no network, no `process.env`. The caller reads the environment
 * and passes the ANSWERS in, which is what makes every branch below testable
 * without a deployment — and these branches are precisely the ones nobody can
 * reproduce on demand, because reproducing them means breaking production.
 *
 * ── IT DESCRIBES, IT DOES NOT ENFORCE ──
 * Nothing here blocks anything. The real gates live in the schedule route
 * (postal address), `authorizeCronRequest` (secret) and `sendCampaignBatch`
 * (postal address again, before claiming). This module exists to EXPLAIN those
 * gates to somebody looking at a stalled campaign. If it ever disagrees with
 * them, the gates are right and this is wrong.
 */

export type BlockerCode =
  | "no_postal_address"
  | "no_list"
  | "no_recipients"
  | "sweep_not_configured"
  | "sender_not_configured"
  | "log_only_mode"
  | "all_recipients_failed";

export type Blocker = {
  code: BlockerCode;
  /** Written for the CLIENT, not the operator. No env var names. */
  message: string;
  /**
   * True when this stops mail reaching anybody. False for things worth saying
   * that are not, by themselves, fatal — a partial failure, say.
   */
  blocking: boolean;
  /**
   * True when only the operator can fix it. The client sees a different
   * instruction: "we are on it" rather than "here is what to do".
   */
  operatorOnly: boolean;
};

export type CampaignHealthInput = {
  status: CampaignStatus;
  listId: number | null;
  recipients: Record<RecipientStatus, number>;
  /** From the workspace row. Null or blank means the send is refused. */
  postalAddress: string | null;
  /** Answers read from the environment by the CALLER. See "pure" above. */
  env: {
    /** CRON_SECRET set, so the scheduled sweep can authenticate. */
    sweepConfigured: boolean;
    /** CAMPAIGN_FROM_ADDRESS set, so an envelope can be built. */
    senderConfigured: boolean;
    /** CAMPAIGN_DELIVERY_MODE === "ses". False means nothing is transmitted. */
    deliveryLive: boolean;
  };
};

export type CampaignHealth = {
  /**
   * `stalled` is the one this module was written for: the campaign believes it
   * is sending and cannot be, which no other part of the product can say.
   */
  state: "draft" | "waiting" | "sending" | "stalled" | "done" | "failed";
  blockers: Blocker[];
  /** Recipients still to be attempted. */
  remaining: number;
};

export function diagnoseCampaign(input: CampaignHealthInput): CampaignHealth {
  const r = input.recipients;
  const remaining = r.queued;
  const attempted = r.sent + r.delivered + r.bounced + r.complained + r.failed;
  const total = remaining + attempted;

  const blockers: Blocker[] = [];

  // Ordered by what a person should fix first, not by severity. The postal
  // address is first because it is the only one the client can fix alone.
  if (!(input.postalAddress ?? "").trim()) {
    blockers.push({
      code: "no_postal_address",
      message:
        "Add your postal address in Settings. Marketing email has to carry a real physical address by law, and we refuse to send without one rather than leave it out.",
      blocking: true,
      operatorOnly: false,
    });
  }

  if (input.listId === null) {
    blockers.push({
      code: "no_list",
      message: "Choose which list this campaign goes to.",
      blocking: true,
      operatorOnly: false,
    });
  } else if (total === 0) {
    blockers.push({
      code: "no_recipients",
      message:
        "Nobody is queued to receive this yet. Queue the recipients, and check the list has confirmed subscribers on it.",
      blocking: true,
      operatorOnly: false,
    });
  }

  if (!input.env.sweepConfigured) {
    blockers.push({
      code: "sweep_not_configured",
      message:
        "Sending is paused on our side — the scheduled worker that delivers campaigns is not running. Nothing has been lost; it will resume from where it stopped.",
      blocking: true,
      operatorOnly: true,
    });
  }

  if (!input.env.senderConfigured) {
    blockers.push({
      code: "sender_not_configured",
      message:
        "Sending is paused on our side — the address campaigns are sent from is not set up yet.",
      blocking: true,
      operatorOnly: true,
    });
  }

  if (!input.env.deliveryLive) {
    blockers.push({
      code: "log_only_mode",
      message:
        "This account cannot send real email yet. Campaigns will be recorded as sent without anything reaching anybody.",
      blocking: true,
      operatorOnly: true,
    });
  }

  // Not blocking — the campaign is finished. But "sent" with every row failed
  // is the single most misleading state the product can show, because
  // settleCampaign counts failed rows as drained and marks it sent.
  if (attempted > 0 && r.failed === attempted) {
    blockers.push({
      code: "all_recipients_failed",
      message:
        "Every message in this campaign failed to send. It is marked as finished, but nobody received it.",
      blocking: false,
      operatorOnly: true,
    });
  }

  return { state: stateOf(input, remaining, blockers), blockers, remaining };
}

function stateOf(
  input: CampaignHealthInput,
  remaining: number,
  blockers: Blocker[],
): CampaignHealth["state"] {
  if (input.status === "failed") return "failed";
  if (input.status === "draft") return "draft";
  if (input.status === "scheduled") return "waiting";
  if (input.status === "sent") return "done";

  // status === "sending". This is the whole point of the module: is it working
  // through the queue, or is it wedged? A blocking reason with rows still
  // queued means the sweep will keep picking it up and keep refusing it, every
  // few minutes, indefinitely — and `sending` is a state the client cannot
  // edit, cancel or discard their way out of.
  if (remaining > 0 && blockers.some((b) => b.blocking)) return "stalled";
  return "sending";
}

/**
 * One line for the campaign list, where there is no room for the full
 * explanation. Deliberately says "stuck" rather than a status word — a client
 * scanning a list needs to know something is wrong before they know what.
 */
export function healthSummary(health: CampaignHealth): string {
  switch (health.state) {
    case "draft":
      return "Draft";
    case "waiting":
      return "Scheduled";
    case "sending":
      return `Sending — ${health.remaining} to go`;
    case "stalled":
      return `Stuck — ${health.remaining} not sent`;
    case "done":
      return health.blockers.some((b) => b.code === "all_recipients_failed")
        ? "Finished — nobody received it"
        : "Sent";
    case "failed":
      return "Failed";
  }
}
