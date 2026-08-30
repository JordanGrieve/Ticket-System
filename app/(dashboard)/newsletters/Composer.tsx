"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignStatus } from "@/db/schema";
import {
  AUDIENCE_SKIP_REASONS,
  CAMPAIGN_BODY_MAX,
  CAMPAIGN_NAME_MAX,
  CAMPAIGN_PREHEADER_MAX,
  CAMPAIGN_SUBJECT_MAX,
  NEWSLETTER_MERGE_TOKENS,
  TEMPLATE_KEYS,
  isEditableStatus,
  renderCampaign,
  unsubscribeUrl,
  type AudienceSkipReason,
  type TemplateKey,
} from "@/lib/newsletter";
import {
  canAbortSend,
  canCancelSchedule,
  canDiscardRecipients,
  canSchedule,
  describeAbort,
  describeDrain,
  SWEEP_CADENCE,
} from "@/lib/campaign-schedule";
import type { CampaignHealth } from "@/lib/campaign-health";
import type { RecipientStatus } from "@/db/schema";

/**
 * The newsletter composer. One page, no wizard.
 *
 * ── WHY THE PREVIEW IS AN IFRAME FED BY renderCampaign() ──
 *
 * `lib/newsletter.ts` is pure — no database, no network, no `process.env` — and
 * its header says exactly why: the composer's preview must run the SAME
 * renderer the send path runs. A preview that renders differently from the
 * sender is worse than no preview. So this component imports `renderCampaign`
 * itself and drops the bytes straight into `srcDoc`. Nothing here re-implements
 * a shell, a paragraph splitter or a merge substitution.
 *
 * The iframe is also the reason email HTML's own colours are allowed to exist
 * on this page at all: the renderer emits inline styles because mail clients
 * demand them, and those bytes are the product. They are quarantined inside a
 * sandboxed document and never touch the app's themed chrome.
 *
 * ── WHAT THIS SCREEN CANNOT DO, AND SAYS SO ──
 *
 * Nothing on this page can email anybody — including the Schedule button:
 *  - no request handler calls `sendCampaignBatch`. Its one caller is the
 *    scheduled sweep, and it takes its deliverer as an argument with no
 *    default;
 *  - that sweep hands every message to the LOG-ONLY deliverer, because
 *    `CAMPAIGN_DELIVERY_MODE` is set in no environment. It writes a log line
 *    and transmits nothing;
 *  - the sweep runs at the cadence in SWEEP_CADENCE (hourly during
 *    development, see SWEEPS_PER_DAY)
 *    (.github/workflows/campaign-sweep.yml), best-effort: GitHub delays or
 *    drops scheduled runs under load, and disables the workflow entirely after
 *    60 days with no commits.
 *
 * Two things this comment used to list as blockers are now DONE, and are kept
 * here named rather than deleted so nobody re-adds them: marketing consent IS
 * enforced (selectAudience buckets `no_consent`), and the CAN-SPAM postal
 * address IS captured and enforced — `workspaces.postal_address` exists,
 * Settings writes it, and both this screen and the schedule route refuse to arm
 * a campaign without one.
 *
 * So there are three actions, and each is named for exactly what it does.
 * "Queue recipients" writes `campaign_recipients` rows. "Remove queued
 * recipients" deletes them again — it exists because queueing used to be a
 * one-way door. "Schedule" writes a status and a timestamp, which is what
 * makes the campaign visible to that log-only sweep. There is no Send button,
 * because a button that looks like it delivers mail and does not is the single
 * most dishonest thing this screen could contain.
 *
 * ── NO INVENTED NUMBERS ──
 *
 * Every count on this page comes from GET /api/campaigns/:id/audience, which
 * runs `selectAudience` — the same function materialisation runs — so the
 * figure shown is suppression-adjusted and de-duplicated by the code that will
 * create the rows. Before a draft is saved with a list there is no count, and
 * the screen says there is no count rather than showing a plausible one.
 */

// ── Props ────────────────────────────────────────────────────────

export type CampaignRowDTO = {
  id: number;
  name: string;
  subject: string;
  status: CampaignStatus;
  listId: number | null;
  listName: string | null;
  recipientCount: number;
  /** ISO — formatted in the browser so it shows the viewer's timezone. */
  updatedAtIso: string;
  sentAtIso: string | null;
};

type ListOption = { id: number; name: string; description: string | null };

// ── Wire shapes ──────────────────────────────────────────────────

/** What /api/campaigns/:id returns for `campaign` (dates arrive as strings). */
type CampaignJson = {
  id: number;
  name: string;
  subject: string;
  preheader: string | null;
  templateKey: string;
  body: string;
  listId: number | null;
  status: CampaignStatus;
  recipientCount: number;
  scheduledAt: string | null;
  updatedAt: string;
  sentAt: string | null;
};

type AudienceJson = {
  recipientCount: number;
  candidateCount: number;
  skipped: Record<AudienceSkipReason, number>;
  skippedTotal: number;
};

type AudienceState =
  | { kind: "unsaved" }
  | { kind: "no_list" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AudienceJson };

type QueueState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "done"; inserted: number; total: number }
  | { kind: "discarded"; deleted: number; total: number };

/** The draft ⇄ scheduled edge, as the screen sees it. */
type ScheduleState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "armed"; immediate: boolean }
  | { kind: "cancelled" };

/**
 * The sending → failed edge. SEPARATE state from `schedule`, and separate on
 * purpose: sharing one state would let "Schedule cancelled. This campaign is a
 * draft again" render after an abort, which is the single most dangerous
 * sentence this screen could get wrong.
 */
type AbortState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "stopped"; stopped: number; alreadySent: number };

/** "As soon as the next sweep runs" vs "at a time I pick". One request either way. */
type WhenMode = "asap" | "at";

// ── Local draft ──────────────────────────────────────────────────

type Draft = {
  /** null until the campaign has been created server-side. */
  id: number | null;
  name: string;
  subject: string;
  preheader: string;
  templateKey: TemplateKey;
  body: string;
  listId: number | null;
  status: CampaignStatus;
  /**
   * Server-held counts and times. Written only from a server response, never
   * by `patch()` — they describe what the database holds, not the form.
   */
  recipientCount: number;
  scheduledAtIso: string | null;
};

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    subject: "",
    preheader: "",
    templateKey: "plain",
    body: "",
    listId: null,
    status: "draft",
    recipientCount: 0,
    scheduledAtIso: null,
  };
}

function draftFrom(c: CampaignJson): Draft {
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    preheader: c.preheader ?? "",
    templateKey: (TEMPLATE_KEYS as readonly string[]).includes(c.templateKey)
      ? (c.templateKey as TemplateKey)
      : "plain",
    body: c.body,
    listId: c.listId,
    status: c.status,
    recipientCount: c.recipientCount,
    scheduledAtIso: c.scheduledAt,
  };
}

// ── Labels ───────────────────────────────────────────────────────

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  plain: "Plain — text on white, no framing",
  branded: "Branded — your workspace name above a card",
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

const SKIP_LABELS: Record<AudienceSkipReason, string> = {
  invalid_email: "Address isn’t usable",
  duplicate: "Same person twice",
  // Ordered above suppression deliberately: suppression is enforced three
  // more times in SQL after selectAudience returns, so mis-attributing it
  // costs a number on a report. Consent has no backstop anywhere — this
  // count is the only signal an operator ever gets that a list is not
  // provably opted in. See hasMarketingConsent in lib/newsletter.ts.
  no_consent: "No consent on record",
  suppressed: "Suppressed",
  unsubscribed: "Unsubscribed",
  bounced: "Hard bounced",
  complained: "Reported as spam",
};

/**
 * The preview recipient.
 *
 * Openly fake, and named so nobody mistakes it for a real subscriber. The merge
 * tokens have to resolve to *something* for the preview to be worth looking at,
 * and resolving them against a real subscriber would mean this page could read
 * the marketing database to draw a picture.
 */
const SAMPLE_RECIPIENT = { email: "sample@example.com", name: "Sample Person" };
/** Shaped like a real token so the footer link looks like what is sent. */
const SAMPLE_TOKEN = "sample-unsubscribe-token";

/**
 * Stands in for a missing postal address IN THE PREVIEW ONLY.
 *
 * It can never reach a recipient: sendCampaignBatch refuses the whole batch
 * before claiming a row when the address is unset, so a workspace in this
 * state sends nothing at all. This exists so the composer still renders, and
 * so the gap is visible in the place it will appear rather than only in a
 * settings screen the client is not currently looking at.
 */
const PREVIEW_ADDRESS_PLACEHOLDER =
  "[Add your postal address in Settings — required before you can send]";

/** Where clients start truncating the subject in the inbox list. */
const SUBJECT_DISPLAY_LIMIT = 70;

type FieldKey = "subject" | "preheader" | "body";

// ── Component ────────────────────────────────────────────────────

export default function Composer({
  initialCampaigns,
  lists,
  workspaceName,
  legalName,
  postalAddress,
  brandAccentHex,
  brandSignOff,
  appUrl,
  viewerEmail,
  recipientsPerSweep,
}: {
  initialCampaigns: CampaignRowDTO[];
  lists: ListOption[];
  workspaceName: string;
  /**
   * The CAN-SPAM identity, straight off the workspace row. Both nullable, and
   * a null postalAddress is the reason a send is refused — so the preview has
   * to show that state rather than hide it. See PREVIEW_ADDRESS_PLACEHOLDER.
   */
  legalName: string | null;
  postalAddress: string | null;
  /**
   * Branding, passed in for the same reason the identity is: the preview runs
   * the REAL renderer, so it must run it with the REAL inputs. A preview that
   * fell back to the Postbox default while the send used the client's colour
   * would be the exact failure lib/newsletter.ts's purity note is about.
   *
   * Unlike postalAddress there is no placeholder branch below — null branding
   * renders the default, which is precisely what the send would do too.
   */
  brandAccentHex: string | null;
  brandSignOff: string | null;
  /** From lib/config, on the server. NEVER imported here — see page.tsx. */
  appUrl: string;
  viewerEmail: string;
  /**
   * `RECIPIENTS_PER_SWEEP` from lib/campaign-cron.ts, passed down as a number
   * for the same reason `appUrl` is: that module imports node:crypto and must
   * not be pulled into the client bundle. Every "how long will this take"
   * figure on this page is computed from it and from SWEEPS_PER_DAY, so the
   * screen cannot describe a throughput the deployed cron does not have.
   */
  recipientsPerSweep: number;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  /** What the server currently holds, which is what the count describes. */
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedListId, setSavedListId] = useState<number | null>(null);
  const [audienceTick, setAudienceTick] = useState(0);
  /**
   * The last COMPLETED count, tagged with the request it answered.
   *
   * Only the fetch callbacks write it, never the effect body: everything that
   * can be derived from what is already in state (no draft yet, no list yet,
   * request in flight) is derived at render instead. Storing those as state and
   * setting them from the effect would be a cascading render — and it is also
   * how a stale count survives a change it should have been invalidated by.
   */
  const [counted, setCounted] = useState<{
    key: string;
    result: { ok: true; data: AudienceJson } | { ok: false; message: string };
  } | null>(null);
  const [queue, setQueue] = useState<QueueState>({ kind: "idle" });

  const [schedule, setSchedule] = useState<ScheduleState>({ kind: "idle" });
  /**
   * The test send. Separate state from `schedule` because it is not part of
   * the draft→scheduled edge at all — it writes nothing and changes no status,
   * so it must not be able to put the schedule UI into a working state.
   */
  /**
   * The server's diagnosis of why this campaign is or is not moving. Null for
   * an unsaved draft, which cannot be stuck yet.
   */
  const [health, setHealth] = useState<CampaignHealth | null>(null);
  /**
   * The per-status recipient counts the campaign GET already returns and this
   * screen used to throw away. The abort confirmation is built from them, and
   * it must not be built from `recipientCount` — that is a cached total of ALL
   * rows, which would tell somebody stopping a campaign that forty thousand
   * people are still queued when thirty thousand have already been mailed.
   */
  const [recipients, setRecipients] = useState<Record<
    RecipientStatus,
    number
  > | null>(null);
  const [abort, setAbort] = useState<AbortState>({ kind: "idle" });
  const [testSend, setTestSend] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "ok"; transmitted: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [whenMode, setWhenMode] = useState<WhenMode>("asap");
  /** A `datetime-local` value — local wall clock, converted on submit. */
  const [whenLocal, setWhenLocal] = useState("");

  const [view, setView] = useState<"desktop" | "mobile">("desktop");

  const subjectRef = useRef<HTMLInputElement>(null);
  const preheaderRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<FieldKey>("body");

  const editable = isEditableStatus(draft.status);
  const listStale = savedId !== null && savedListId !== draft.listId;

  // ── The count ──────────────────────────────────────────────────
  // Fetched for what the SERVER holds, never for the unsaved form: the endpoint
  // reads campaigns.list_id, so counting an unsaved list choice would show a
  // number for the wrong audience.
  const countKey =
    savedId === null || savedListId === null
      ? null
      : `${savedId}:${savedListId}:${audienceTick}`;

  useEffect(() => {
    if (countKey === null) return;
    const [id] = countKey.split(":");

    let cancelled = false;
    fetch(`/api/campaigns/${id}/audience`)
      .then(async (res) => {
        const payload = (await res.json()) as Partial<AudienceJson> & {
          error?: string;
        };
        if (cancelled) return;
        setCounted({
          key: countKey,
          result: res.ok
            ? { ok: true, data: payload as AudienceJson }
            : {
                ok: false,
                message: payload.error ?? "Couldn’t count this audience.",
              },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCounted({
          key: countKey,
          result: {
            ok: false,
            message: "Couldn’t reach the server to count this audience.",
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [countKey]);

  // Derived, not stored. A result whose key no longer matches the request we
  // would make now is not shown at all — it describes a different audience.
  const audience: AudienceState =
    savedId === null
      ? { kind: "unsaved" }
      : savedListId === null
        ? { kind: "no_list" }
        : counted?.key !== countKey
          ? { kind: "loading" }
          : counted.result.ok
            ? { kind: "ready", data: counted.result.data }
            : { kind: "error", message: counted.result.message };

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
    setDirty(true);
    setSaved(false);
    setQueue({ kind: "idle" });
    setSchedule({ kind: "idle" });
  }

  /**
   * Nothing on this page autosaves, so switching away from unsaved edits would
   * silently bin them. One browser confirm is ugly and is still the cheapest
   * honest answer; a draft-recovery buffer is not Phase 1 work.
   */
  function confirmDiscard(): boolean {
    if (!dirty) return true;
    return window.confirm(
      "You have unsaved changes to this campaign. Discard them?",
    );
  }

  function startNew() {
    if (!confirmDiscard()) return;
    setDraft(emptyDraft());
    setSavedId(null);
    setSavedListId(null);
    setDirty(false);
    setSaved(false);
    setError(null);
    setQueue({ kind: "idle" });
    setSchedule({ kind: "idle" });
  }

  async function refreshList() {
    try {
      const res = await fetch("/api/campaigns");
      if (!res.ok) return;
      const payload = (await res.json()) as {
        campaigns: (Omit<CampaignRowDTO, "updatedAtIso" | "sentAtIso"> & {
          updatedAt: string;
          sentAt: string | null;
        })[];
      };
      setCampaigns(
        payload.campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          subject: c.subject,
          status: c.status,
          listId: c.listId,
          listName: c.listName,
          recipientCount: c.recipientCount,
          updatedAtIso: c.updatedAt,
          sentAtIso: c.sentAt,
        })),
      );
    } catch {
      // A stale sidebar is not worth an error banner over the editor.
    }
  }

  async function open(id: number) {
    if (loadingId !== null) return;
    if (id !== draft.id && !confirmDiscard()) return;
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}`);
      const payload = (await res.json()) as {
        campaign?: CampaignJson;
        health?: CampaignHealth;
        recipients?: Record<RecipientStatus, number>;
        error?: string;
      };
      if (!res.ok || !payload.campaign) {
        setError(payload.error ?? "Couldn’t open that campaign.");
        return;
      }
      setDraft(draftFrom(payload.campaign));
      setSavedId(payload.campaign.id);
      setSavedListId(payload.campaign.listId);
      setRecipients(payload.recipients ?? null);
      // The server computed this on the way past. It was already being
      // computed before today and thrown away here, which is how a campaign
      // could sit wedged with the explanation sitting unread in the response.
      setHealth(payload.health ?? null);
      setDirty(false);
      setSaved(false);
      setQueue({ kind: "idle" });
      setSchedule({ kind: "idle" });
      setAbort({ kind: "idle" });
    } catch {
      setError("Couldn’t reach the server.");
    } finally {
      setLoadingId(null);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: draft.name,
        subject: draft.subject,
        preheader: draft.preheader.trim() ? draft.preheader : null,
        templateKey: draft.templateKey,
        body: draft.body,
        listId: draft.listId,
      });
      const res =
        draft.id === null
          ? await fetch("/api/campaigns", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            })
          : await fetch(`/api/campaigns/${draft.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body,
            });

      const payload = (await res.json()) as {
        campaign?: CampaignJson;
        error?: string;
      };
      if (!res.ok || !payload.campaign) {
        setError(payload.error ?? "Couldn’t save this campaign.");
        return;
      }

      setDraft(draftFrom(payload.campaign));
      setSavedId(payload.campaign.id);
      setSavedListId(payload.campaign.listId);
      setDirty(false);
      setSaved(true);
      await refreshList();
    } catch {
      setError("Couldn’t reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Phase one of the send: create the recipient rows.
   *
   * Idempotent by construction (INSERT … ON CONFLICT DO NOTHING), suppression
   * -filtered inside the statement that writes, and incapable of emailing
   * anyone. It is called "queue" on the button because that is precisely and
   * only what it does.
   */
  async function queueRecipients() {
    if (savedId === null || queue.kind === "working") return;
    setQueue({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/audience`, {
        method: "POST",
      });
      const payload = (await res.json()) as {
        inserted?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        setQueue({
          kind: "error",
          message: payload.error ?? "Couldn’t queue this campaign.",
        });
        return;
      }
      const total = payload.total ?? 0;
      setQueue({ kind: "done", inserted: payload.inserted ?? 0, total });
      setDraft((d) => ({ ...d, recipientCount: total }));
      setAudienceTick((n) => n + 1);
      await refreshList();
    } catch {
      setQueue({
        kind: "error",
        message: "Couldn’t reach the server.",
      });
    }
  }

  /**
   * Throw the queued rows away again — the way back out of "Queue recipients".
   *
   * Confirmed, because it is a delete of up to tens of thousands of rows, and
   * the confirm names the number so it cannot be waved through blind. The
   * server refuses it for anything other than a `draft` campaign regardless of
   * what this function believes.
   */
  async function discardRecipients() {
    if (savedId === null || queue.kind === "working") return;
    const n = draft.recipientCount;
    const ok = window.confirm(
      n > 0
        ? `Remove ${n.toLocaleString()} queued recipient ${
            n === 1 ? "row" : "rows"
          } from this campaign? The rows are deleted; you can queue the list again afterwards.`
        : "Remove this campaign's queued recipients?",
    );
    if (!ok) return;

    setQueue({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/audience`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as {
        deleted?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        setQueue({
          kind: "error",
          message: payload.error ?? "Couldn’t remove these recipients.",
        });
        return;
      }
      const total = payload.total ?? 0;
      setQueue({ kind: "discarded", deleted: payload.deleted ?? 0, total });
      setDraft((d) => ({ ...d, recipientCount: total }));
      setAudienceTick((n2) => n2 + 1);
      await refreshList();
    } catch {
      setQueue({ kind: "error", message: "Couldn’t reach the server." });
    }
  }

  /**
   * Arm the campaign: draft → scheduled.
   *
   * ONE request for both modes. "As soon as the next sweep runs" simply omits
   * `scheduledAt`, and the server resolves that to `now`; a picked time is sent
   * as an ISO instant so the server is never guessing at a timezone. There is
   * no second endpoint that sends immediately, and there is nothing here that
   * reaches an email provider — see the panel this button sits in.
   */
  /**
   * Send this draft to the signed-in user's own address, once.
   *
   * Writes nothing and transitions nothing — see the route header. The
   * recipient is fixed server-side to the session's address; there is no
   * parameter here to change it, and adding one would turn this into a relay.
   */
  async function sendTestToMyself() {
    if (savedId === null || testSend.kind === "working") return;
    setTestSend({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/test-send`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        transmitted?: boolean;
      };
      if (!res.ok) {
        setTestSend({
          kind: "error",
          message: data.error ?? "That didn’t send.",
        });
        return;
      }
      setTestSend({ kind: "ok", transmitted: data.transmitted === true });
    } catch {
      setTestSend({ kind: "error", message: "That didn’t send." });
    }
  }

  async function armSchedule() {
    if (savedId === null || schedule.kind === "working") return;

    let scheduledAt: string | null = null;
    if (whenMode === "at") {
      if (!whenLocal) {
        setSchedule({ kind: "error", message: "Pick a date and time first." });
        return;
      }
      const parsed = new Date(whenLocal);
      if (Number.isNaN(parsed.getTime())) {
        setSchedule({
          kind: "error",
          message: "Couldn’t read that date and time.",
        });
        return;
      }
      scheduledAt = parsed.toISOString();
    }

    setSchedule({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt }),
      });
      const payload = (await res.json()) as {
        campaign?: CampaignJson;
        immediate?: boolean;
        error?: string;
      };
      if (!res.ok || !payload.campaign) {
        setSchedule({
          kind: "error",
          message: payload.error ?? "Couldn’t schedule this campaign.",
        });
        return;
      }
      setDraft(draftFrom(payload.campaign));
      setSavedListId(payload.campaign.listId);
      setSchedule({ kind: "armed", immediate: payload.immediate === true });
      await refreshList();
    } catch {
      setSchedule({ kind: "error", message: "Couldn’t reach the server." });
    }
  }

  /** Disarm it again: scheduled → draft. The recipient rows are left alone. */
  async function cancelSchedule() {
    if (savedId === null || schedule.kind === "working") return;
    setSchedule({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/schedule`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as {
        campaign?: CampaignJson;
        error?: string;
      };
      if (!res.ok || !payload.campaign) {
        setSchedule({
          kind: "error",
          message: payload.error ?? "Couldn’t cancel this schedule.",
        });
        return;
      }
      setDraft(draftFrom(payload.campaign));
      setSavedListId(payload.campaign.listId);
      setSchedule({ kind: "cancelled" });
      await refreshList();
    } catch {
      setSchedule({ kind: "error", message: "Couldn’t reach the server." });
    }
  }

  /**
   * STOP a send in progress: sending → failed. Not the same act as
   * `cancelSchedule` above and not the same word.
   *
   * The confirmation text comes from `describeAbort` rather than being written
   * inline here, so the exact wording a person reads before an irreversible act
   * on a live audience is pinned by a test instead of by whoever last edited
   * this file. It is built from the per-status breakdown the server sent, never
   * from `recipientCount` — that is every row ever created for the campaign,
   * and quoting it as "still queued" would understate what has already gone out
   * by exactly the number of people who received it.
   *
   * When the breakdown is missing (an older response, a failed refresh) the
   * numbers are NOT guessed. The confirm says so instead: a made-up "0 already
   * sent" is the one error here that could not be walked back.
   */
  async function abortSend() {
    if (savedId === null || abort.kind === "working") return;

    const ok = window.confirm(
      recipients
        ? describeAbort({
            queued: recipients.queued,
            alreadySent:
              recipients.sent +
              recipients.delivered +
              recipients.bounced +
              recipients.complained,
          })
        : "Stop this campaign for good?\n\nWe couldn’t read how many people have already been sent this, so this may stop a campaign that is part way through a live audience. Anyone already mailed cannot be un-mailed.\n\nThis cannot be undone. The campaign is marked Failed and can’t be edited, re-scheduled or sent again.",
    );
    if (!ok) return;

    setAbort({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/abort`, {
        method: "POST",
      });
      const payload = (await res.json()) as {
        stopped?: number;
        alreadySent?: number;
        error?: string;
      };
      if (!res.ok) {
        setAbort({
          kind: "error",
          message: payload.error ?? "Couldn’t stop this campaign.",
        });
        return;
      }
      // Re-read rather than patching the status locally. The counts on screen
      // after an abort are the campaign report, and a report assembled from
      // what this function assumed happened is exactly the kind of number that
      // gets quoted back in a complaint.
      //
      // Ordered before the setAbort below because `open` clears this state —
      // it is per-campaign, so opening one has to forget the last one's result.
      await open(savedId);
      await refreshList();
      setAbort({
        kind: "stopped",
        stopped: payload.stopped ?? 0,
        alreadySent: payload.alreadySent ?? 0,
      });
    } catch {
      setAbort({ kind: "error", message: "Couldn’t reach the server." });
    }
  }

  /** Insert a merge token at the caret of whichever field was last focused. */
  function insertToken(token: string) {
    const key = lastFocused.current;
    const el =
      key === "subject"
        ? subjectRef.current
        : key === "preheader"
          ? preheaderRef.current
          : bodyRef.current;
    if (!el || !editable) return;

    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);

    if (key === "subject") patch({ subject: next.slice(0, CAMPAIGN_SUBJECT_MAX) });
    else if (key === "preheader")
      patch({ preheader: next.slice(0, CAMPAIGN_PREHEADER_MAX) });
    else patch({ body: next.slice(0, CAMPAIGN_BODY_MAX) });

    // Restore the caret after React re-renders the controlled value.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  // ── The preview, through the real renderer ─────────────────────
  const rendered = useMemo(
    () =>
      renderCampaign({
        campaign: {
          subject: draft.subject,
          preheader: draft.preheader.trim() ? draft.preheader : null,
          templateKey: draft.templateKey,
          body: draft.body,
        },
        recipient: SAMPLE_RECIPIENT,
        workspaceName,
        unsubscribeUrl: unsubscribeUrl(appUrl, SAMPLE_TOKEN),
        brand: { accentHex: brandAccentHex, signOff: brandSignOff },
        sender: {
          workspaceName,
          legalName,
          // renderCampaign THROWS on an absent address — deliberately, so no
          // commercial message can be built without one. The preview is the
          // one place that must still render, so it substitutes a placeholder
          // that names the gap. It reads as an instruction rather than as an
          // address, which is the point: the client sees exactly where their
          // address will sit and that it is not there yet.
          postalAddress: postalAddress?.trim()
            ? postalAddress
            : PREVIEW_ADDRESS_PLACEHOLDER,
        },
      }),
    [
      draft.subject,
      draft.preheader,
      draft.templateKey,
      draft.body,
      workspaceName,
      legalName,
      postalAddress,
      brandAccentHex,
      brandSignOff,
      appUrl,
    ],
  );

  /**
   * Whether this workspace may lawfully send at all.
   *
   * Mirrors mailableSender() in lib/newsletter.ts, which is the authority —
   * but that module is not importable here (it is reached through
   * renderCampaign only, and this is a client component). The rule is one
   * trimmed-string check, so restating it costs less than the indirection, and
   * the server enforces it independently either way.
   */
  const canSendLegally = (postalAddress ?? "").trim().length > 0;

  const subjectLong = draft.subject.length > SUBJECT_DISPLAY_LIMIT;
  const canSave =
    editable &&
    dirty &&
    !saving &&
    draft.name.trim().length > 0 &&
    draft.subject.trim().length > 0 &&
    draft.body.trim().length > 0;

  return (
    <div className="nl-wrap">
      {/* ── Campaign list ──────────────────────────────────────── */}
      <aside className="nl-rail" aria-label="Campaigns">
        <div className="nl-rail-head">
          <h1 className="nl-rail-title">Newsletters</h1>
          <button type="button" className="nl-new" onClick={startNew}>
            New
          </button>
        </div>

        {campaigns.length === 0 ? (
          <p className="nl-rail-empty">
            No campaigns yet. “New” starts a draft — drafts are saved to your
            workspace and are not sent to anyone.
          </p>
        ) : (
          <ul className="nl-list">
            {campaigns.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="nl-item"
                  data-current={c.id === draft.id}
                  aria-current={c.id === draft.id ? "true" : undefined}
                  onClick={() => open(c.id)}
                  disabled={loadingId !== null}
                >
                  <span className="nl-item-top">
                    <span className="nl-item-name">{c.name}</span>
                    <span className="nl-status" data-status={c.status}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </span>
                  <span className="nl-item-sub">{c.subject}</span>
                  <span className="nl-item-meta">
                    {c.listName ?? "No audience list"}
                    {c.recipientCount > 0
                      ? ` · ${c.recipientCount} queued`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* ── Composer ───────────────────────────────────────────── */}
      <div className="nl-main">
        <header className="nl-head">
          <div className="nl-head-text">
            <h2 className="nl-title">
              {draft.id === null ? "New campaign" : draft.name || "Untitled"}
            </h2>
            <p className="nl-sub">
              Write it, preview exactly what a recipient would receive, and
              choose who it is for. Nothing on this page emails anybody — see
              “What happens when you queue this” below.
            </p>
          </div>
          <div className="nl-head-actions">
            {saved && !dirty && (
              <span className="nl-saved" role="status">
                Saved
              </span>
            )}
            <button
              type="button"
              className="nl-save"
              onClick={save}
              disabled={!canSave}
            >
              {saving ? "Saving…" : draft.id === null ? "Create draft" : "Save draft"}
            </button>
          </div>
        </header>

        {error && (
          <p className="nl-error" role="alert">
            {error}
          </p>
        )}

        {!editable && (
          <p className="nl-note nl-note--warn">
            This campaign is <b>{STATUS_LABELS[draft.status]}</b> and can no
            longer be edited. Changing the subject of a campaign that has
            recipients would mean two different emails went out under one name.
          </p>
        )}

        <div className="nl-grid">
          {/* ── Left: the form ───────────────────────────────── */}
          <div className="nl-col">
            <section className="nl-card">
              <h3 className="nl-card-title">The email</h3>

              <div className="nl-field">
                <label className="nl-label" htmlFor="nl-name">
                  Campaign name
                </label>
                <input
                  id="nl-name"
                  className="nl-input"
                  value={draft.name}
                  maxLength={CAMPAIGN_NAME_MAX}
                  disabled={!editable}
                  onChange={(e) => patch({ name: e.target.value })}
                />
                <p className="nl-help">
                  Internal only — recipients never see it. Use whatever you will
                  recognise in the list on the left.
                </p>
              </div>

              <div className="nl-field">
                <label className="nl-label" htmlFor="nl-subject">
                  Subject line
                </label>
                <input
                  id="nl-subject"
                  ref={subjectRef}
                  className="nl-input"
                  value={draft.subject}
                  maxLength={CAMPAIGN_SUBJECT_MAX}
                  disabled={!editable}
                  onFocus={() => {
                    lastFocused.current = "subject";
                  }}
                  onChange={(e) => patch({ subject: e.target.value })}
                  aria-describedby="nl-subject-help"
                />
                <p className="nl-help" id="nl-subject-help">
                  {draft.subject.length}/{CAMPAIGN_SUBJECT_MAX} characters.
                  {subjectLong
                    ? ` Most inboxes cut the subject off around ${SUBJECT_DISPLAY_LIMIT} characters — the rest is stored and sent, just not shown in the list.`
                    : ""}
                </p>
              </div>

              <div className="nl-field">
                <label className="nl-label" htmlFor="nl-preheader">
                  Preheader
                  <span className="nl-optional">optional</span>
                </label>
                <input
                  id="nl-preheader"
                  ref={preheaderRef}
                  className="nl-input"
                  value={draft.preheader}
                  maxLength={CAMPAIGN_PREHEADER_MAX}
                  disabled={!editable}
                  onFocus={() => {
                    lastFocused.current = "preheader";
                  }}
                  onChange={(e) => patch({ preheader: e.target.value })}
                />
                <p className="nl-help">
                  The line the inbox shows after the subject. Leave it empty and
                  clients scrape the first visible words instead, so every
                  campaign previews as your greeting.
                </p>
              </div>

              <div className="nl-field">
                <label className="nl-label" htmlFor="nl-template">
                  Layout
                </label>
                <select
                  id="nl-template"
                  className="nl-select"
                  value={draft.templateKey}
                  disabled={!editable}
                  onChange={(e) =>
                    patch({ templateKey: e.target.value as TemplateKey })
                  }
                >
                  {TEMPLATE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {TEMPLATE_LABELS[key]}
                    </option>
                  ))}
                </select>
                <p className="nl-help">
                  These are the two layouts the renderer actually has. The
                  campaign stores which one it uses, not the finished HTML, so a
                  later fix to a layout also fixes campaigns already written.
                </p>
              </div>
            </section>

            <section className="nl-card">
              <h3 className="nl-card-title">Body</h3>
              <p className="nl-card-sub">
                Plain text. Blank lines become paragraphs and bare links become
                links; everything else is escaped, so nothing a subscriber’s
                name contains can alter what other people receive.
              </p>

              <div className="nl-tokens" role="group" aria-label="Insert a merge tag">
                {NEWSLETTER_MERGE_TOKENS.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    className="nl-token"
                    disabled={!editable}
                    title={t.hint}
                    onClick={() => insertToken(t.token)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="nl-help">
                Inserted where you last had the cursor — subject, preheader or
                body. Anything in braces that isn’t one of these is deleted
                before sending, never passed through.
              </p>

              <div className="nl-field">
                <label className="nl-label" htmlFor="nl-body">
                  Message
                </label>
                <textarea
                  id="nl-body"
                  ref={bodyRef}
                  className="nl-textarea"
                  value={draft.body}
                  maxLength={CAMPAIGN_BODY_MAX}
                  rows={14}
                  disabled={!editable}
                  onFocus={() => {
                    lastFocused.current = "body";
                  }}
                  onChange={(e) => patch({ body: e.target.value })}
                />
                <p className="nl-help">
                  {draft.body.length.toLocaleString()} of{" "}
                  {CAMPAIGN_BODY_MAX.toLocaleString()} characters.
                </p>
              </div>
            </section>

            {/* ── Audience ───────────────────────────────────── */}
            <section className="nl-card">
              <h3 className="nl-card-title">Audience</h3>

              <div className="nl-field">
                <label className="nl-label" htmlFor="nl-list">
                  Audience list
                </label>
                <select
                  id="nl-list"
                  className="nl-select"
                  value={draft.listId === null ? "" : String(draft.listId)}
                  disabled={!editable || lists.length === 0}
                  onChange={(e) =>
                    patch({
                      listId: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">No list chosen</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {lists.length === 0 && (
                  <p className="nl-help">
                    This workspace has no audience lists. There is no list or
                    subscriber management screen yet — lists exist in the
                    database and nothing in the app creates them.
                  </p>
                )}
              </div>

              <AudienceReadout
                state={audience}
                stale={listStale}
                hasList={draft.listId !== null}
              />
            </section>
          </div>

          {/* ── Right: preview + the honest bit ──────────────── */}
          <div className="nl-col">
            <section className="nl-card nl-card--preview">
              <div className="nl-preview-head">
                <div>
                  <h3 className="nl-card-title">Preview</h3>
                  <p className="nl-card-sub">
                    Rendered by the same function the send path calls, against a
                    made-up recipient (<code>{SAMPLE_RECIPIENT.email}</code>).
                  </p>
                </div>
                <div
                  className="nl-seg"
                  role="group"
                  aria-label="Preview width"
                >
                  <button
                    type="button"
                    className="nl-seg-btn"
                    data-on={view === "desktop"}
                    aria-pressed={view === "desktop"}
                    onClick={() => setView("desktop")}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    className="nl-seg-btn"
                    data-on={view === "mobile"}
                    aria-pressed={view === "mobile"}
                    onClick={() => setView("mobile")}
                  >
                    Mobile
                  </button>
                </div>
              </div>

              <div className="nl-envelope">
                <p className="nl-env-row">
                  <span className="nl-env-key">Subject</span>
                  <span className="nl-env-val">
                    {rendered.subject || (
                      <em className="nl-env-empty">No subject yet</em>
                    )}
                  </span>
                </p>
                <p className="nl-env-row">
                  <span className="nl-env-key">Preview line</span>
                  <span className="nl-env-val">
                    {draft.preheader.trim() ? (
                      draft.preheader
                    ) : (
                      <em className="nl-env-empty">
                        None — the inbox will scrape your opening words
                      </em>
                    )}
                  </span>
                </p>
              </div>

              {/*
                THE ONE PLACE ON THIS PAGE WITH COLOURS THAT ARE NOT TOKENS.
                The document inside carries the renderer's own inline styles
                because mail clients strip stylesheets — those bytes are the
                product, and theming them would make the preview a lie. They are
                confined to this sandboxed iframe: `sandbox=""` with no
                allow-list means no scripts, no navigation, no form submission,
                and no access to this origin. The frame's own chrome (the border
                and the paper it sits on) is tokenised in newsletter.css.
              */}
              <div className="nl-frame" data-view={view}>
                <iframe
                  className="nl-iframe"
                  title="Newsletter preview"
                  sandbox=""
                  srcDoc={rendered.html}
                />
              </div>

              <details className="nl-details">
                <summary className="nl-summary">
                  Plain-text part (what text-only clients get)
                </summary>
                <pre className="nl-pre">{rendered.text}</pre>
              </details>
            </section>

            {/* ── What queueing does, and does not do ────────── */}
            <section className="nl-card">
              <h3 className="nl-card-title">What happens when you queue this</h3>

              <ul className="nl-facts">
                <li className="nl-fact nl-fact--yes">
                  <b>Recipient rows are created</b> — one per person on the list,
                  suppressed and duplicate addresses excluded by the query that
                  writes them. Running it twice adds only what was missing.
                </li>
                <li className="nl-fact nl-fact--no">
                  <b>No email is sent.</b> Nothing on this page reaches an email
                  provider. The send loop takes its delivery function as an
                  argument and has no default, and there is no live sender
                  configured — the fallback writes a log line and transmits
                  nothing.
                </li>
                <li className="nl-fact nl-fact--no">
                  <b>Queueing alone starts nothing.</b> Rows sit at “queued”
                  until the campaign is scheduled below. Nothing picks up an
                  unscheduled campaign.
                </li>
                <li className="nl-fact nl-fact--yes">
                  <b>You can undo it.</b> “Remove queued recipients” deletes the
                  rows again while the campaign is still a draft, so queueing
                  the wrong list costs nothing.
                </li>
                <li className="nl-fact nl-fact--no">
                  <b>It would not be lawful to send yet.</b> CAN-SPAM requires a
                  physical postal address in every message and there is no field
                  to store one, so the footer cannot carry it.
                </li>
              </ul>

              <div className="nl-queue-row">
                <button
                  type="button"
                  className="nl-queue"
                  onClick={queueRecipients}
                  disabled={
                    savedId === null ||
                    savedListId === null ||
                    draft.status !== "draft" ||
                    dirty ||
                    queue.kind === "working"
                  }
                >
                  {queue.kind === "working" ? "Working…" : "Queue recipients"}
                </button>

                {/*
                  The other half of the one-way door. Rendered whenever the
                  campaign holds rows, not tucked behind a menu: the whole
                  point is that somebody who has just queued the wrong list can
                  see the way back without going looking for it.
                */}
                <button
                  type="button"
                  className="nl-unqueue"
                  onClick={discardRecipients}
                  disabled={
                    savedId === null ||
                    !canDiscardRecipients(draft.status) ||
                    draft.recipientCount === 0 ||
                    queue.kind === "working"
                  }
                  aria-describedby="nl-unqueue-why"
                >
                  Remove queued recipients
                </button>
              </div>

              <p className="nl-help" id="nl-unqueue-why">
                Removing recipients deletes the queued rows only, and only while
                this is a draft — rows that were already sent, bounced or failed
                are the campaign’s record of what happened and are never
                deleted. Cancel the schedule first if the campaign is armed.
              </p>

              <div className="nl-queue-row">
                {/*
                  No test-send affordance exists to wire this to: there is no
                  route that sends a campaign anywhere, to the author or to
                  anyone else. Rendered disabled with the reason rather than as
                  a button that quietly does nothing.
                */}
                <button
                  type="button"
                  className="nl-test"
                  disabled
                  aria-describedby="nl-test-why"
                >
                  Send a test to {viewerEmail}
                </button>
              </div>

              <p className="nl-help" id="nl-test-why">
                Test sends are off because there is nothing to send through: no
                API route reaches an email provider with a campaign, and the
                marketing sending domain isn’t verified. The preview above is
                the same HTML a test would have carried.
              </p>

              {savedId === null && (
                <p className="nl-help">Create the draft first.</p>
              )}
              {savedId !== null && savedListId === null && (
                <p className="nl-help">Choose an audience list and save.</p>
              )}
              {savedId !== null && dirty && (
                <p className="nl-help">
                  Save your changes first — queueing uses what the server holds,
                  not what is on screen.
                </p>
              )}
              {savedId !== null && draft.status === "scheduled" && (
                <p className="nl-help">
                  This campaign is scheduled. Cancel the schedule below to
                  change its recipients.
                </p>
              )}

              {queue.kind === "error" && (
                <p className="nl-error" role="alert">
                  {queue.message}
                </p>
              )}
              {queue.kind === "done" && (
                <p className="nl-note" role="status">
                  {queue.inserted === 0
                    ? "Nothing new to queue — every eligible recipient already had a row."
                    : `${queue.inserted.toLocaleString()} recipient ${
                        queue.inserted === 1 ? "row" : "rows"
                      } created.`}{" "}
                  {queue.total.toLocaleString()} in total, all sitting at
                  “queued”. No email has been sent, and none will be — the
                  scheduled sweep has no live sender configured.
                </p>
              )}
              {queue.kind === "discarded" && (
                <p className="nl-note" role="status">
                  {queue.deleted === 0
                    ? "Nothing to remove — this campaign had no queued rows."
                    : `${queue.deleted.toLocaleString()} queued ${
                        queue.deleted === 1 ? "row" : "rows"
                      } deleted.`}{" "}
                  {queue.total.toLocaleString()} recipient{" "}
                  {queue.total === 1 ? "row" : "rows"} left on this campaign.
                </p>
              )}
            </section>

            {/* ── The draft ⇄ scheduled edge ─────────────────── */}
            <section className="nl-card">
              <h3 className="nl-card-title">Schedule this campaign</h3>

              <p className="nl-card-sub">
                Scheduling marks the campaign as due and nothing more. A
                background sweep picks up due campaigns{" "}
                <b>{SWEEP_CADENCE}</b> — that cadence is best effort,
                so an individual run can arrive late or be skipped altogether.
              </p>

              <ul className="nl-facts">
                <li className="nl-fact nl-fact--no">
                  <b>No email leaves the building.</b> The sweep hands every
                  message to a log-only deliverer. There is no live sending
                  provider configured in any environment, so a scheduled
                  campaign writes log lines, marks its rows “sent”, and reaches
                  nobody.
                </li>
                <li className="nl-fact nl-fact--no">
                  <b>Consent isn’t enforced yet.</b> Until it is, this cannot be
                  pointed at real inboxes even if a sender were configured.
                </li>
                <li className="nl-fact nl-fact--yes">
                  <b>It is reversible until the sweep starts.</b> Cancel returns
                  the campaign to draft and leaves its recipients alone. Once
                  the sweep has begun, it can’t be pulled back.
                </li>
              </ul>

              {draft.recipientCount > 0 && (
                <p className="nl-note">
                  {describeDrain(draft.recipientCount, recipientsPerSweep)}
                </p>
              )}

              {/*
                Why this campaign is not moving. Rendered only when there is
                something to say — a healthy campaign gets no panel, because a
                reassurance box on every screen is noise that trains people to
                skip the one that matters.

                Hoisted OUT of the arming form below, where it used to live.
                "stalled" is by definition a `sending` campaign, and `sending`
                is the branch that now offers Stop — so leaving the diagnosis
                inside the branch that renders the arming form would mean the
                explanation vanished from precisely the screen a person reaches
                when they are deciding whether to stop.
              */}
              {health && health.blockers.length > 0 && (
                <div
                  className={health.state === "stalled" ? "nl-warn" : "nl-note"}
                  role="status"
                >
                  <b>
                    {health.state === "stalled"
                      ? `This campaign is stuck — ${health.remaining} ${
                          health.remaining === 1 ? "person has" : "people have"
                        } not been sent to.`
                      : "Before this can send:"}
                  </b>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                    {health.blockers.map((b) => (
                      <li key={b.code} style={{ marginBottom: 4 }}>
                        {b.message}
                        {b.operatorOnly && (
                          <>
                            {" "}
                            <em>We&rsquo;ve been told about this one.</em>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/*
                ── THREE BRANCHES, NOT TWO ──

                `sending` is checked FIRST. It used to fall through to the
                arming form, which rendered a "When" fieldset and a Schedule
                button that were disabled and pointless — the screen's answer to
                a wedged campaign was a greyed-out control for a transition that
                had already happened. The only action that applies to a campaign
                mid-send is stopping it, so that is the only action it shows.
              */}
              {canAbortSend(draft.status) ? (
                <AbortPanel
                  state={abort}
                  recipients={recipients}
                  stalled={health?.state === "stalled"}
                  onAbort={abortSend}
                />
              ) : draft.status === "scheduled" ? (
                <>
                  <p className="nl-note nl-note--warn" role="status">
                    Scheduled for{" "}
                    <b>
                      {draft.scheduledAtIso
                        ? new Date(draft.scheduledAtIso).toLocaleString()
                        : "the next sweep"}
                    </b>
                    . The first sweep at or after that time will start working
                    through the queued rows — writing log lines, not email.
                  </p>
                  {schedule.kind === "armed" && (
                    <p className="nl-note" role="status">
                      {schedule.immediate
                        ? `Scheduled for now, which means the next sweep — they run ${SWEEP_CADENCE}.`
                        : "Scheduled."}{" "}
                      Nothing has been emailed and nothing will be: the sweep’s
                      deliverer only writes to the log.
                    </p>
                  )}
                  <div className="nl-queue-row">
                    <button
                      type="button"
                      className="nl-queue"
                      onClick={cancelSchedule}
                      disabled={
                        !canCancelSchedule(draft.status) ||
                        schedule.kind === "working"
                      }
                    >
                      {schedule.kind === "working"
                        ? "Cancelling…"
                        : "Cancel schedule"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <fieldset className="nl-field">
                    <legend className="nl-label">When</legend>

                    <label className="nl-radio" htmlFor="nl-when-asap">
                      <input
                        id="nl-when-asap"
                        type="radio"
                        name="nl-when"
                        value="asap"
                        checked={whenMode === "asap"}
                        disabled={!canSchedule(draft.status)}
                        onChange={() => {
                          setWhenMode("asap");
                          setSchedule({ kind: "idle" });
                        }}
                      />{" "}
                      As soon as the next sweep runs
                    </label>

                    <label className="nl-radio" htmlFor="nl-when-at">
                      <input
                        id="nl-when-at"
                        type="radio"
                        name="nl-when"
                        value="at"
                        checked={whenMode === "at"}
                        disabled={!canSchedule(draft.status)}
                        onChange={() => {
                          setWhenMode("at");
                          setSchedule({ kind: "idle" });
                        }}
                      />{" "}
                      At a time I choose
                    </label>

                    <input
                      id="nl-when-value"
                      className="nl-input"
                      type="datetime-local"
                      aria-label="Scheduled date and time"
                      value={whenLocal}
                      disabled={whenMode !== "at" || !canSchedule(draft.status)}
                      onChange={(e) => {
                        setWhenLocal(e.target.value);
                        setSchedule({ kind: "idle" });
                      }}
                    />
                    <p className="nl-help">
                      Your local time. Either way the campaign waits for a
                      sweep, so &ldquo;as soon as possible&rdquo; means the next
                      sweep — they run {SWEEP_CADENCE} — not instantly. Sweeps
                      are best-effort and can be delayed when the scheduler is
                      busy.
                    </p>
                  </fieldset>

                  {!canSendLegally && (
                    <p className="nl-warn" role="status">
                      <b>Add your postal address before scheduling.</b> Marketing
                      email has to carry a real physical address by law, so
                      Postbox refuses the send rather than leaving it out. Add
                      it under <b>Settings → Sender identity</b>, then come back.
                    </p>
                  )}

                  {/*
                    The test send. Above the Schedule button deliberately: it is
                    the thing you should press first, and it is the only action
                    on this screen that produces a real message without
                    committing anything.
                  */}
                  <div className="nl-queue-row">
                    <button
                      type="button"
                      className="nl-secondary"
                      onClick={sendTestToMyself}
                      disabled={
                        savedId === null ||
                        dirty ||
                        !canSendLegally ||
                        testSend.kind === "working"
                      }
                    >
                      {testSend.kind === "working"
                        ? "Sending…"
                        : "Send a test to myself"}
                    </button>
                    <span className="nl-help">
                      Goes to <b>{viewerEmail}</b> and nowhere else. Writes
                      nothing, schedules nothing.
                    </span>
                  </div>

                  {testSend.kind === "ok" && (
                    <p className="nl-note" role="status">
                      {testSend.transmitted ? (
                        <>
                          Sent to <b>{viewerEmail}</b>. Check the footer carries
                          your postal address and that the unsubscribe link is
                          there — the link in a test belongs to nobody, so
                          pressing it does nothing.
                        </>
                      ) : (
                        <>
                          <b>Nothing was transmitted.</b> Delivery is still in
                          log-only mode, so this was written to the server log
                          instead of sent. Set{" "}
                          <code>CAMPAIGN_DELIVERY_MODE=ses</code> to send for
                          real.
                        </>
                      )}
                    </p>
                  )}
                  {testSend.kind === "error" && (
                    <p className="nl-error" role="status">
                      {testSend.message}
                    </p>
                  )}

                  <div className="nl-queue-row">
                    <button
                      type="button"
                      className="nl-queue"
                      onClick={armSchedule}
                      disabled={
                        savedId === null ||
                        savedListId === null ||
                        !canSchedule(draft.status) ||
                        dirty ||
                        draft.recipientCount === 0 ||
                        // The server refuses this too (409 from the schedule
                        // route). Disabling here is not the guard, it is the
                        // explanation — a button that fails on press teaches
                        // nothing, and the state it would have created is
                        // unrecoverable from inside the product.
                        !canSendLegally ||
                        schedule.kind === "working"
                      }
                    >
                      {schedule.kind === "working"
                        ? "Scheduling…"
                        : "Schedule campaign"}
                    </button>
                  </div>

                  {savedId === null && (
                    <p className="nl-help">Create the draft first.</p>
                  )}
                  {savedId !== null && savedListId === null && (
                    <p className="nl-help">
                      Choose an audience list and save. A campaign with no list
                      can’t be scheduled.
                    </p>
                  )}
                  {savedId !== null &&
                    savedListId !== null &&
                    draft.recipientCount === 0 && (
                      <p className="nl-help">
                        Queue the recipients first. A campaign with nobody
                        queued would be marked sent without reaching anyone, so
                        scheduling one is refused.
                      </p>
                    )}
                  {savedId !== null && !canSchedule(draft.status) && (
                    <p className="nl-help">
                      This campaign is {STATUS_LABELS[draft.status].toLowerCase()}{" "}
                      and can’t be scheduled again.
                    </p>
                  )}
                </>
              )}

              {schedule.kind === "error" && (
                <p className="nl-error" role="alert">
                  {schedule.message}
                </p>
              )}
              {schedule.kind === "cancelled" && (
                <p className="nl-note" role="status">
                  Schedule cancelled. This campaign is a draft again and its
                  queued recipients are untouched.
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stopping a send in progress ──────────────────────────────────

/**
 * The only control a `sending` campaign gets.
 *
 * ── IT IS NOT STYLED AS "CANCEL SCHEDULE" ──
 *
 * Different verb, different className, and the numbers are on screen BEFORE the
 * confirm rather than only inside it. Cancelling a schedule costs nothing and
 * can be redone in a second; this ends a campaign part way through a real
 * audience and cannot be redone at all. A person who has cancelled a schedule
 * twice this week should not be able to press this on the same reflex.
 *
 * The counts are shown even when nothing is wrong, because "this is fine, it is
 * just working through the queue" and "this will never move again" are the two
 * things a person is choosing between, and only one of them is worth stopping.
 */
function AbortPanel({
  state,
  recipients,
  stalled,
  onAbort,
}: {
  state: AbortState;
  recipients: Record<RecipientStatus, number> | null;
  stalled: boolean;
  onAbort: () => void;
}) {
  const alreadySent =
    recipients === null
      ? null
      : recipients.sent +
        recipients.delivered +
        recipients.bounced +
        recipients.complained;

  return (
    <>
      <p className="nl-note nl-note--warn" role="status">
        This campaign is <b>sending</b>. It can’t be edited, re-scheduled, or
        have its recipients changed — those rows are already being worked
        through. {stalled
          ? "It is also not moving, and it will keep re-entering the sweep every few minutes until something changes."
          : "The sweep is working through it a batch at a time."}
      </p>

      {recipients !== null && alreadySent !== null && (
        <ul className="nl-facts">
          <li className="nl-fact nl-fact--no">
            <b>
              {alreadySent.toLocaleString()}{" "}
              {alreadySent === 1 ? "person has" : "people have"} already been
              sent this.
            </b>{" "}
            Those messages were handed over before you got here and cannot be
            recalled. Stopping does not touch them, and they stay on the report
            as mailed.
          </li>
          <li className="nl-fact nl-fact--yes">
            <b>
              {recipients.queued.toLocaleString()}{" "}
              {recipients.queued === 1 ? "person is" : "people are"} still
              queued.
            </b>{" "}
            Stopping is the only thing that reaches them — they would never be
            sent this campaign.
          </li>
        </ul>
      )}

      <div className="nl-queue-row">
        <button
          type="button"
          className="nl-danger"
          onClick={onAbort}
          disabled={state.kind === "working"}
        >
          {state.kind === "working" ? "Stopping…" : "Stop this campaign"}
        </button>
        <span className="nl-help">
          Ends the campaign for good and marks it <b>Failed</b>. There is no way
          back to draft and no way to finish the send afterwards.
        </span>
      </div>

      {state.kind === "error" && (
        <p className="nl-error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === "stopped" && (
        <p className="nl-note nl-note--warn" role="status">
          <b>Stopped.</b>{" "}
          {state.stopped === 0
            ? "Nobody was still queued, so nobody was cut off."
            : `${state.stopped.toLocaleString()} queued ${
                state.stopped === 1 ? "recipient" : "recipients"
              } will never be sent this campaign.`}{" "}
          {state.alreadySent === 0
            ? "Nobody had been sent it."
            : `${state.alreadySent.toLocaleString()} ${
                state.alreadySent === 1 ? "person" : "people"
              } had already been sent it, and that cannot be undone.`}{" "}
          The campaign is marked Failed and the sweep will not pick it up again.
        </p>
      )}
    </>
  );
}

// ── Audience readout ─────────────────────────────────────────────

/**
 * The recipient count, or an honest reason there isn't one.
 *
 * Never renders a number it did not receive from the server. "Unknown" is a
 * legitimate state here and is shown as such: an audience figure that is a
 * guess is the one number on this screen that could cause real-world harm.
 */
function AudienceReadout({
  state,
  stale,
  hasList,
}: {
  state: AudienceState;
  stale: boolean;
  hasList: boolean;
}) {
  if (state.kind === "unsaved") {
    return (
      <p className="nl-help">
        Save the draft to count its audience. The count comes from the server,
        which is the only thing that knows who is suppressed.
      </p>
    );
  }

  if (stale) {
    return (
      <p className="nl-note">
        {hasList
          ? "You’ve changed the list. Save to count it — the number below would describe the old audience."
          : "You’ve cleared the list. Save to confirm."}
      </p>
    );
  }

  if (state.kind === "no_list") {
    return (
      <p className="nl-help">
        No list chosen, so there is no audience and no count.
      </p>
    );
  }

  if (state.kind === "loading") {
    return (
      <p className="nl-help" role="status">
        Counting…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="nl-error" role="alert">
        {state.message}
      </p>
    );
  }

  const { data } = state;
  const skips = AUDIENCE_SKIP_REASONS.filter((r) => data.skipped[r] > 0);

  return (
    <div className="nl-count">
      <p className="nl-count-num">
        <b>{data.recipientCount.toLocaleString()}</b>{" "}
        {data.recipientCount === 1 ? "person" : "people"} would be mailed
      </p>
      <p className="nl-help">
        From {data.candidateCount.toLocaleString()} on the list, after removing
        suppressions, duplicates and anyone unsubscribed. Suppression outranks
        whatever a subscriber row claims about itself, so this is the number the
        send would actually use.
      </p>

      {skips.length > 0 && (
        <ul className="nl-skips">
          {skips.map((r) => (
            <li key={r} className="nl-skip">
              <span className="nl-skip-n">{data.skipped[r].toLocaleString()}</span>
              <span className="nl-skip-l">{SKIP_LABELS[r]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
