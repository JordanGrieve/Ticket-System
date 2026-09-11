"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignProduct, CampaignStatus } from "@/db/schema";
import { canRequeueFailed, describeRequeue } from "@/lib/campaign-requeue";
import {
  AUDIENCE_SKIP_REASONS,
  CAMPAIGN_BODY_MAX,
  STARTER_CAMPAIGN_BODY,
  unfilledSlots,
  CAMPAIGN_NAME_MAX,
  CAMPAIGN_PREHEADER_MAX,
  CAMPAIGN_SUBJECT_MAX,
  NEWSLETTER_MERGE_TOKENS,
  TEMPLATE_KEYS,
  isEditableStatus,
  renderCampaign,
  MAX_PRODUCTS,
  safeImageUrl,
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
} from "@/lib/campaign-schedule";
import type { CampaignHealth } from "@/lib/campaign-health";
import { CAMPAIGN_TEMPLATES } from "@/lib/campaign-templates";
import {
  describeWhen,
  primaryLabel,
  readinessSteps,
  readyToSend,
  scheduledSummary,
  type WhenMode,
} from "@/lib/campaign-readiness";
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
 * ── HOW A MESSAGE ON THIS SCREEN REACHES A PERSON ──
 *
 * Not from here. No request handler on this page calls `sendCampaignBatch`
 * except test-send, which mails the viewer and nobody else:
 *  - the Schedule button ARMS a campaign; it does not send it. The one caller
 *    of `sendCampaignBatch` is the scheduled sweep, which takes its deliverer
 *    as an argument with no default;
 *  - that sweep hands every message to the provider named by
 *    `CAMPAIGN_DELIVERY_MODE`, and since 11 Sep 2026 that is `resend` in
 *    production. It used to be unset everywhere, and this comment used to say
 *    so — do not read the rest of it as if nothing transmits;
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
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  products: CampaignProduct[] | null;
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
  /** As authored. Validated server-side; empty string means none. */
  heroImageUrl: string;
  heroImageAlt: string;
  /**
   * Products, as authored. Strings rather than CampaignProduct, because a
   * half-typed URL is a normal state of a form and null is not a thing a text
   * input can hold. Converted on save.
   */
  products: DraftProduct[];
  status: CampaignStatus;
  /**
   * Server-held counts and times. Written only from a server response, never
   * by `patch()` — they describe what the database holds, not the form.
   */
  recipientCount: number;
  scheduledAtIso: string | null;
};

/**
 * One product row while it is being typed.
 *
 * The id is a client-side key and never leaves the browser. React needs a
 * stable key per row, and the array index is not one: deleting the second of
 * four rows would have React reuse the third row's DOM for the fourth, so the
 * text in a focused input would jump to the row above it.
 */
type DraftProduct = {
  id: number;
  name: string;
  imageUrl: string;
  price: string;
  url: string;
};

let nextProductId = 1;

function blankProduct(): DraftProduct {
  return { id: nextProductId++, name: "", imageUrl: "", price: "", url: "" };
}

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    subject: "",
    preheader: "",
    templateKey: "plain",
    heroImageUrl: "",
    heroImageAlt: "",
    products: [],
    // Not "". See STARTER_CAMPAIGN_BODY — a default turns writing into
    // editing, and it is the only place the merge tokens are demonstrated
    // rather than merely listed.
    body: STARTER_CAMPAIGN_BODY,
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
    heroImageUrl: c.heroImageUrl ?? "",
    heroImageAlt: c.heroImageAlt ?? "",
    products: (c.products ?? []).map((p) => ({
      id: nextProductId++,
      name: p.name,
      imageUrl: p.imageUrl ?? "",
      price: p.price ?? "",
      url: p.url ?? "",
    })),
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
  const [deleting, setDeleting] = useState(false);
  /** The Delete button's second press. See destroy(). */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  /** The unqueue button has become its own "are you sure?" — see below. */
  const [confirmingUnqueue, setConfirmingUnqueue] = useState(false);
  /** Putting a wholly-failed campaign back in the queue. */
  const [requeue, setRequeue] = useState<
    { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string }
  >({ kind: "idle" });

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
  /** Which template this draft was started from. Presentational only. */
  const [startedFrom, setStartedFrom] = useState("blank");
  const [whenMode, setWhenMode] = useState<WhenMode>("now");
  /** Local wall clock, two fields; lib/campaign-readiness turns them into an instant. */
  const [whenDate, setWhenDate] = useState("");
  const [whenTime, setWhenTime] = useState("");

  const [view, setView] = useState<"desktop" | "mobile">("desktop");

  const subjectRef = useRef<HTMLInputElement>(null);
  const preheaderRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<FieldKey>("body");

  const editable = isEditableStatus(draft.status);

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
   *
   * ── DELIBERATE EXCEPTION TO THE NO-window.confirm RULE ──
   * The InstallView task asks whoever moves that view off browser dialogs to
   * decide whether this file follows, and to write down which. It does, for
   * two of the three, and this is the one that does NOT.
   *
   * The reason is not that a browser dialog is nice here. It is that this is a
   * SYNCHRONOUS gate on a NAVIGATION, called from two places — starting a new
   * draft, and selecting a different campaign — and it has to answer before
   * either proceeds. An inline panel cannot: it would mean deferring both
   * callers behind a promise and restructuring the control flow of the whole
   * component, to replace an interruption with a different interruption.
   *
   * "You clicked away from unsaved work" is also the one moment a modal is
   * genuinely the right shape. The others are actions with their own button,
   * where the consequence belongs beside the control.
   *
   * The honest cost: like every window.confirm it renders in the operating
   * system's palette rather than the workspace's, and cannot be asserted on in
   * a test. That is the trade, not a claim it is better in every way.
   */
  /*
    ── CONVERTED, 8 SEP 2026 — AND HOW THE "SYNCHRONOUS GATE" ARGUMENT WENT ──
    The header above was right that a browser confirm answers before either
    caller proceeds and an inline panel cannot. What it did not say is that
    the callers do not need an ANSWER, only a way to be RESUMED: each one
    records what it was about to do, returns, and the panel replays it with
    `force` if the person says discard. Neither caller's control flow moved;
    each grew one parameter.

    The rest of the pattern is the one the other three use: alertdialog, the
    safe choice focused, Escape backs out, focus goes back to whatever was
    pressed. There are now no browser-native dialogs in the client.
  */
  type PendingNav = { kind: "new" } | { kind: "open"; id: number };
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);
  /** Whatever was pressed to get here — the New button or a campaign row. */
  const navReturnFocus = useRef<HTMLElement | null>(null);

  /** True if the caller may proceed now; false if it has been parked. */
  function guardNavigation(next: PendingNav): boolean {
    if (!dirty) return true;
    // <body> is what activeElement reports when nothing is focused; returning
    // focus there is the exact drop-to-nowhere this is meant to prevent.
    const active = document.activeElement;
    navReturnFocus.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setPendingNav(next);
    return false;
  }

  function keepEditing() {
    setPendingNav(null);
    navReturnFocus.current?.focus();
    navReturnFocus.current = null;
  }

  function discardAndGo() {
    const next = pendingNav;
    setPendingNav(null);
    navReturnFocus.current = null;
    if (!next) return;
    if (next.kind === "new") startNew(true);
    else void open(next.id, true);
  }

  useEffect(() => {
    if (pendingNav === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") keepEditing();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // keepEditing is stable in what it does; the listener only needs to exist
    // while there is a question to dismiss.
  }, [pendingNav]);

  /** `force` is the panel replaying a parked call after "Discard changes". */
  function startNew(force = false) {
    if (!force && !guardNavigation({ kind: "new" })) return;
    setDraft(emptyDraft());
    setStartedFrom("blank");
    setSavedId(null);
    setSavedListId(null);
    setDirty(false);
    setSaved(false);
    setError(null);
    setQueue({ kind: "idle" });
    setSchedule({ kind: "idle" });
  }

  /**
   * Delete the open draft.
   *
   * Two presses, not a modal. The first turns the button into "Delete for
   * good?" and the second does it; clicking anything else, or saving, puts it
   * back. A confirm dialog would be the other answer, but this screen already
   * has a discard-changes panel and a second one arguing about a different
   * thing would be two dialogs deep on a phone.
   *
   * Drafts only, which is why the button is not rendered in any other state:
   * the server refuses the rest, and offering a control that always fails is
   * worse than not offering it.
   */
  async function destroy() {
    if (draft.id === null || deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${draft.id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Couldn’t delete this campaign.");
        setConfirmingDelete(false);
        return;
      }
      // `force`: the draft is gone from the server, so the unsaved-changes
      // guard has nothing left to protect and would only ask about a campaign
      // that no longer exists.
      startNew(true);
      await refreshList();
    } catch {
      setError("Couldn’t reach the server. Check your connection and retry.");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
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

  async function open(id: number, force = false) {
    if (loadingId !== null) return;
    if (id !== draft.id && !force && !guardNavigation({ kind: "open", id }))
      return;
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
        // Empty means "no image". Sent as null so clearing the field clears
        // the column rather than storing "".
        heroImageUrl: draft.heroImageUrl.trim() || null,
        heroImageAlt: draft.heroImageAlt.trim() || null,
        // A nameless row is an empty one the author has not filled in yet.
        // parseProducts skips them too; dropping them here as well keeps the
        // round-trip stable, so saving twice does not grow the list.
        products: draft.products
          .filter((p) => p.name.trim())
          .map((p) => ({
            name: p.name.trim(),
            imageUrl: p.imageUrl.trim() || null,
            price: p.price.trim() || null,
            url: p.url.trim() || null,
          })),
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
  /**
   * Converted off window.confirm first, before the discard guard above was.
   *
   * This one qualified immediately: it is asynchronous, it has a single call
   * site, and it is triggered by its own button — so the question
   * can be asked in the place the answer applies to, which is the whole
   * argument. Same pattern as LabelManager's delete row and InstallView's key
   * rotation.
   */
  async function discardRecipients() {
    if (savedId === null || queue.kind === "working") return;
    setConfirmingUnqueue(false);

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
    if (whenMode === "later") {
      const w = describeWhen(whenDate, whenTime, new Date(), timeZone);
      if (!w.ok) {
        setSchedule({ kind: "error", message: w.text });
        return;
      }
      scheduledAt = w.iso;
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
  /**
   * Put every recipient back in the queue and return the campaign to draft.
   *
   * Offered ONLY when the campaign reached nobody — lib/campaign-requeue.ts
   * carries the argument for refusing the partly-delivered case outright
   * rather than warning about it. The server re-checks the same condition
   * inside its UPDATE, because the sweep could claim a row between this screen
   * reading its counts and the write landing.
   */
  async function requeueFailed() {
    if (savedId === null || requeue.kind === "working") return;
    setRequeue({ kind: "working" });
    try {
      const res = await fetch(`/api/campaigns/${savedId}/requeue`, {
        method: "POST",
      });
      const payload = (await res.json()) as {
        requeued?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "Couldn't put those back.");
      }
      /*
        Reload the campaign and the list, the same way abortSend does. The
        status has changed underneath this screen — sent/failed back to draft,
        and every recipient row back to queued — so re-reading is the only way
        the panel, the counts and the health line agree with the database.
        `open` clears the requeue state, so it is set idle afterwards.
      */
      await open(savedId);
      await refreshList();
      setRequeue({ kind: "idle" });
    } catch (err) {
      setRequeue({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Couldn't put those back.",
      });
    }
  }

  /*
    Converted off window.confirm on 8 Sep 2026 — the last of the three. The
    question is asked by AbortPanel, in the place the answer applies to, with
    the same counts describeAbort always named; this is only ever reached
    once the person has said yes there. With the discard guard converted the
    same day, there are no browser-native dialogs left in the client.
  */
  async function abortSend() {
    if (savedId === null || abort.kind === "working") return;

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

    if (key === "subject")
      patch({ subject: next.slice(0, CAMPAIGN_SUBJECT_MAX) });
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
        // The preview shows the image the moment a usable URL is typed, and
        // shows nothing while it is half-typed — which is also what tells the
        // author their link is wrong, before the server says so.
        hero: (() => {
          const url = safeImageUrl(draft.heroImageUrl);
          const alt = draft.heroImageAlt.trim();
          return url && alt ? { url, alt } : null;
        })(),
        // Same rule as the hero: a row appears in the preview once it has a
        // name, and a link that is still being typed simply is not one yet.
        products: draft.products
          .filter((p) => p.name.trim())
          .map((p) => ({
            name: p.name.trim(),
            imageUrl: p.imageUrl.trim() ? safeImageUrl(p.imageUrl) : null,
            price: p.price.trim() || null,
            url: p.url.trim() ? safeImageUrl(p.url) : null,
          })),
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
      draft.heroImageUrl,
      draft.heroImageAlt,
      draft.products,
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

  /*
    The bracketed slots from the starter body, still unfilled. A WARNING and
    not a block: see unfilledSlots(). Introducing a default that contains
    "[...]" creates a new way to mail placeholder text to a real list, so the
    default and this check ship together — one without the other is a worse
    screen than the blank box they replaced.
  */
  const slots = unfilledSlots(draft.body);

  /*
    The checklist and the primary button's state, from lib/campaign-readiness.
    `ready` is the same set of conditions the Schedule button used to spell
    out inline; the server still refuses independently (409 from the schedule
    route), so this is the explanation, not the guard.
  */
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const steps = readinessSteps({
    saved: savedId !== null,
    dirty,
    audienceCount: audience.kind === "ready" ? audience.data.recipientCount : null,
    queued: draft.recipientCount,
    placeholders: slots.length,
    postalAddress: canSendLegally,
  });
  const ready = readyToSend(steps, draft.status);
  const when =
    whenMode === "later" ? describeWhen(whenDate, whenTime, new Date(), timeZone) : null;

  /** Where each unmet step is fixed. Focus or scroll; never a page change except Settings. */
  function goFix(fix: (typeof steps)[number]["fix"]) {
    if (fix === "save") {
      save();
    } else if (fix === "signup") {
      // Nobody has confirmed yet. The fix is the signup form, which lives on
      // the Install screen — not anything on this page.
      window.location.assign("/settings/install");
    } else if (fix === "queue") {
      document.getElementById("nl-recipients")?.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (fix === "body") {
      bodyRef.current?.focus();
    } else {
      window.location.assign("/settings");
    }
  }

  /*
    Whether this finished campaign can go back in the queue.

    Null until the recipient counts have loaded — the answer depends entirely
    on them, and defaulting to "no" would hide the control from the person who
    needs it for as long as the numbers take to arrive.
  */
  const requeueVerdict =
    recipients === null
      ? null
      : canRequeueFailed(draft.status, {
          queued: recipients.queued,
          reached:
            recipients.sent +
            recipients.delivered +
            recipients.bounced +
            recipients.complained,
          failed: recipients.failed,
        });

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
          {/* Not `onClick={startNew}`: the event would arrive as `force`. */}
          <button type="button" className="nl-new" onClick={() => startNew()}>
            New
          </button>
        </div>

        {pendingNav !== null && (
          /* Sits under the rail head, between the two things that can raise
             it — the New button above and the campaign rows below. */
          <div
            className="nl-confirm"
            role="alertdialog"
            aria-label="Unsaved changes"
            aria-describedby="nl-discard-q"
          >
            <p className="nl-confirm-q" id="nl-discard-q">
              You have unsaved changes to this campaign.{" "}
              {pendingNav.kind === "new"
                ? "Starting a new one throws them away."
                : "Opening another one throws them away."}
            </p>
            <div className="nl-confirm-acts">
              <button
                type="button"
                className="nl-confirm-btn"
                autoFocus
                onClick={keepEditing}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="nl-confirm-btn nl-confirm-btn--danger"
                onClick={discardAndGo}
              >
                Discard changes
              </button>
            </div>
          </div>
        )}

        {campaigns.length === 0 ? (
          <p className="nl-rail-empty">No campaigns yet.</p>
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
          </div>
          <div className="nl-head-actions">
            {saved && !dirty && (
              <span className="nl-saved" role="status">
                Saved
              </span>
            )}
            {/*
              Only for a saved DRAFT. A campaign that has sent is the record of
              what a client's customers were told, and the server refuses to
              delete one — a button that always fails is worse than no button.
            */}
            {draft.id !== null && draft.status === "draft" && (
              <button
                type="button"
                className="nl-delete"
                onClick={destroy}
                onBlur={() => setConfirmingDelete(false)}
                disabled={deleting}
                aria-label={
                  confirmingDelete
                    ? `Delete ${draft.name || "this campaign"} for good`
                    : `Delete ${draft.name || "this campaign"}`
                }
              >
                {deleting
                  ? "Deleting…"
                  : confirmingDelete
                    ? "Delete for good?"
                    : "Delete"}
              </button>
            )}
            <button
              type="button"
              className="nl-save"
              onClick={save}
              disabled={!canSave}
            >
              {saving
                ? "Saving…"
                : draft.id === null
                  ? "Create draft"
                  : "Save draft"}
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
            {/*
              ── START FROM ──
              Only on a campaign that has never been saved. Once there is a
              draft on the server, pressing one of these would silently
              replace work somebody has already done — and the undo for that
              is "retype it".
            */}
            {draft.id === null && editable && (
              <section className="nl-card">
                <h3 className="nl-card-title">Start from</h3>
                <div className="nl-seg" role="group" aria-label="Start from a template">
                  {CAMPAIGN_TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="nl-seg-btn"
                      data-on={startedFrom === t.key}
                      aria-pressed={startedFrom === t.key}
                      onClick={() => {
                        setStartedFrom(t.key);
                        // Subject only when the template has one: "From
                        // scratch" must not wipe a subject already typed.
                        patch(t.subject ? { subject: t.subject, body: t.body } : { body: t.body });
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                <p className="nl-help">
                  {CAMPAIGN_TEMPLATES.find((t) => t.key === startedFrom)?.description}
                </p>
              </section>
            )}

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
              </div>

              {/*
                ── THE IMAGE ──
                A URL the client already has, from their own shop or site.
                Postbox hosts no files, so there is nothing to upload to.

                The description is not optional and the hint says why: Gmail
                and Outlook block remote images by default for a sender
                somebody has not corresponded with, which is most recipients
                of a first newsletter. For them the description IS the image.
              */}
              <div className="nl-field">
                <label className="nl-label" htmlFor="nl-hero-url">
                  Image <span className="nl-optional">OPTIONAL</span>
                </label>
                <input
                  id="nl-hero-url"
                  className="nl-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://yourshop.com/photo.jpg"
                  value={draft.heroImageUrl}
                  maxLength={2000}
                  disabled={!editable}
                  onChange={(e) => patch({ heroImageUrl: e.target.value })}
                />
                {draft.heroImageUrl.trim() && !safeImageUrl(draft.heroImageUrl) && (
                  <p className="nl-warn" role="status">
                    That link can&rsquo;t be used. It needs to start with{" "}
                    <b>https://</b>
                  </p>
                )}
              </div>

              {draft.heroImageUrl.trim() && (
                <div className="nl-field">
                  <label className="nl-label" htmlFor="nl-hero-alt">
                    Describe the image
                  </label>
                  <input
                    id="nl-hero-alt"
                    className="nl-input"
                    type="text"
                    placeholder="A tray of sourdough, just out of the oven"
                    value={draft.heroImageAlt}
                    maxLength={200}
                    disabled={!editable}
                    onChange={(e) => patch({ heroImageAlt: e.target.value })}
                  />
                  <p className="nl-help">
                    Most people have images turned off, and read this instead.
                    Keep anything that matters — a price, a date — in the
                    message as well as the picture.
                  </p>
                </div>
              )}

              {/*
                ── PRODUCTS ──
                A short grid under the message: a photo, a name, a price, a
                link. The name IS the link when there is one, so a product is
                one target rather than a name and a "Buy" beside it.

                Rows are added one at a time rather than starting with three
                blanks. Three empty rows read as three things you are expected
                to fill in; an empty section with one button reads as optional,
                which it is.
              */}
              <div className="nl-field">
                <span className="nl-label" id="nl-products-label">
                  Products <span className="nl-optional">OPTIONAL</span>
                </span>

                <ul className="nl-products" aria-labelledby="nl-products-label">
                  {draft.products.map((p, i) => (
                    <li className="nl-product" key={p.id}>
                      <div className="nl-product-head">
                        <span className="nl-product-n">{i + 1}</span>
                        <button
                          type="button"
                          className="nl-product-x"
                          disabled={!editable}
                          onClick={() =>
                            patch({
                              products: draft.products.filter((q) => q.id !== p.id),
                            })
                          }
                        >
                          Remove<span className="stg-sr-only"> product {i + 1}</span>
                        </button>
                      </div>

                      <label className="nl-sublabel" htmlFor={`nl-p-name-${p.id}`}>
                        Name
                      </label>
                      <input
                        id={`nl-p-name-${p.id}`}
                        className="nl-input"
                        type="text"
                        placeholder="Sourdough loaf"
                        value={p.name}
                        maxLength={120}
                        disabled={!editable}
                        onChange={(e) =>
                          patch({
                            products: draft.products.map((q) =>
                              q.id === p.id ? { ...q, name: e.target.value } : q,
                            ),
                          })
                        }
                      />

                      <label className="nl-sublabel" htmlFor={`nl-p-price-${p.id}`}>
                        Price
                      </label>
                      {/*
                        Free text, not a number input. "from £2" and "2 for £5"
                        are prices a bakery actually charges, and a number field
                        would make them untypable.
                      */}
                      <input
                        id={`nl-p-price-${p.id}`}
                        className="nl-input"
                        type="text"
                        placeholder="£3.50"
                        value={p.price}
                        maxLength={40}
                        disabled={!editable}
                        onChange={(e) =>
                          patch({
                            products: draft.products.map((q) =>
                              q.id === p.id ? { ...q, price: e.target.value } : q,
                            ),
                          })
                        }
                      />

                      <label className="nl-sublabel" htmlFor={`nl-p-img-${p.id}`}>
                        Photo link
                      </label>
                      <input
                        id={`nl-p-img-${p.id}`}
                        className="nl-input"
                        type="url"
                        inputMode="url"
                        placeholder="https://yourshop.com/loaf.jpg"
                        value={p.imageUrl}
                        maxLength={2000}
                        disabled={!editable}
                        onChange={(e) =>
                          patch({
                            products: draft.products.map((q) =>
                              q.id === p.id ? { ...q, imageUrl: e.target.value } : q,
                            ),
                          })
                        }
                      />
                      {p.imageUrl.trim() && !safeImageUrl(p.imageUrl) && (
                        <p className="nl-warn" role="status">
                          That photo link can&rsquo;t be used. It needs to start
                          with <b>https://</b>
                        </p>
                      )}

                      <label className="nl-sublabel" htmlFor={`nl-p-url-${p.id}`}>
                        Buy link
                      </label>
                      <input
                        id={`nl-p-url-${p.id}`}
                        className="nl-input"
                        type="url"
                        inputMode="url"
                        placeholder="https://yourshop.com/loaf"
                        value={p.url}
                        maxLength={2000}
                        disabled={!editable}
                        onChange={(e) =>
                          patch({
                            products: draft.products.map((q) =>
                              q.id === p.id ? { ...q, url: e.target.value } : q,
                            ),
                          })
                        }
                      />
                      {p.url.trim() && !safeImageUrl(p.url) && (
                        <p className="nl-warn" role="status">
                          That link can&rsquo;t be used. It needs to start with{" "}
                          <b>https://</b>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                {draft.products.length < MAX_PRODUCTS ? (
                  <button
                    type="button"
                    className="stg-button"
                    disabled={!editable}
                    onClick={() =>
                      patch({ products: [...draft.products, blankProduct()] })
                    }
                  >
                    Add a product
                  </button>
                ) : (
                  <p className="nl-help" role="status">
                    That&rsquo;s {MAX_PRODUCTS}, the most one newsletter can
                    carry.
                  </p>
                )}
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
              </div>
            </section>

            <section className="nl-card">
              <h3 className="nl-card-title">Body</h3>

              <div
                className="nl-tokens"
                role="group"
                aria-label="Insert a merge tag"
              >
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

              {/*
                No list picker. A campaign goes to everyone in the workspace
                who has confirmed and not unsubscribed — Jordan's call,
                11 Sep 2026: one thank-you on signup, and then everyone. The
                picker it replaces was worse than redundant: nothing has ever
                written a row to `list_subscribers`, so every list was empty
                and every campaign it gated was unsendable.
              */}
              <AudienceReadout state={audience} />
            </section>
          </div>

          {/* ── Right: preview + the honest bit ──────────────── */}
          <div className="nl-col">
            <section className="nl-card nl-card--preview">
              <div className="nl-preview-head">
                <div>
                  <h3 className="nl-card-title">Preview</h3>
                </div>
                <div className="nl-seg" role="group" aria-label="Preview width">
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
              <h3 className="nl-card-title" id="nl-recipients">Recipients</h3>

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
                {confirmingUnqueue ? (
                  /* The control becomes the question. The count is the whole
                     point of asking — "remove 47 rows" is a different decision
                     from "remove 4000". */
                  <div
                    className="nl-confirm"
                    role="alertdialog"
                    aria-label="Remove queued recipients"
                    aria-describedby="nl-unqueue-q"
                  >
                    <p className="nl-confirm-q" id="nl-unqueue-q">
                      {draft.recipientCount > 0
                        ? `Remove ${draft.recipientCount.toLocaleString()} queued recipient ${
                            draft.recipientCount === 1 ? "row" : "rows"
                          }?`
                        : "Remove this campaign's queued recipients?"}{" "}
                      The rows are deleted; you can queue the list again
                      afterwards.
                    </p>
                    <div className="nl-confirm-acts">
                      {/* Cancel first and focused: the button that was under
                          the pointer has just unmounted, so focus has to land
                          somewhere and the safe choice changes nothing. */}
                      <button
                        type="button"
                        className="nl-confirm-btn"
                        autoFocus
                        onClick={() => setConfirmingUnqueue(false)}
                      >
                        Keep them
                      </button>
                      <button
                        type="button"
                        className="nl-confirm-btn nl-confirm-btn--danger"
                        onClick={discardRecipients}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="nl-unqueue"
                    onClick={() => setConfirmingUnqueue(true)}
                    disabled={
                      savedId === null ||
                      !canDiscardRecipients(draft.status) ||
                      draft.recipientCount === 0 ||
                      queue.kind === "working"
                    }
                  >
                    Remove queued recipients
                  </button>
                )}
              </div>

              {savedId === null && (
                <p className="nl-help">Create the draft first.</p>
              )}
              {savedId !== null && savedListId === null && (
                <p className="nl-help">Choose an audience list and save.</p>
              )}
              {savedId !== null && dirty && (
                <p className="nl-help">Save your changes first.</p>
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
              ) : requeueVerdict?.ok ? (
                /*
                  A finished campaign that reached NOBODY. Until this existed
                  the only exit was building the whole thing again, and with a
                  one-person list the person was spent — docs/NEWSLETTER.md
                  warned about exactly that.

                  Offered only in the all-failed case. The partly-delivered one
                  is not a confirmation away, it is absent, because a retry
                  there could put a second copy in a real inbox.
                */
                <>
                  <p className="nl-note nl-note--warn" role="status">
                    This campaign finished and <b>nobody received it</b>. Every
                    attempt failed, so nothing was delivered and nobody was
                    emailed twice.
                  </p>
                  <div className="nl-queue-row">
                    <button
                      type="button"
                      className="nl-secondary"
                      onClick={requeueFailed}
                      disabled={requeue.kind === "working"}
                    >
                      {requeue.kind === "working"
                        ? "Putting them back…"
                        : "Put the recipients back and edit"}
                    </button>
                    <span className="nl-help">
                      {describeRequeue(requeueVerdict)} Fix whatever stopped it
                      first — a failure this complete is usually one cause, not
                      many.
                    </span>
                  </div>
                  {requeue.kind === "error" && (
                    <p className="nl-error" role="alert">
                      {requeue.message}
                    </p>
                  )}
                </>
              ) : draft.status === "scheduled" ? (
                /*
                  Armed. One status row — when, and for how many — with the
                  way back beside it. The paragraphs about sweeps and log
                  lines that used to sit here explained the machinery; the
                  row states the fact.
                */
                <div className="nl-status-row" role="status">
                  <span className="nl-status-dot" aria-hidden />
                  <span className="nl-status-text">
                    {scheduledSummary(draft.scheduledAtIso, draft.recipientCount, timeZone)}
                  </span>
                  <button
                    type="button"
                    className="nl-linkbtn"
                    onClick={cancelSchedule}
                    disabled={!canCancelSchedule(draft.status) || schedule.kind === "working"}
                  >
                    {schedule.kind === "working" ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
              ) : (
                <>
                  {/*
                    ── THE CHECKLIST ──
                    Every condition the primary button waits on, as a list
                    with ticks, each unmet one a link to where it is fixed.
                    lib/campaign-readiness.ts decides the ticks; this draws
                    them. Before this there were five disabled buttons and
                    one grey line naming the first unmet step.
                  */}
                  <ol className="nl-ready" aria-label="Before this can send">
                    {steps.map((s) => (
                      <li key={s.key} className="nl-ready-item" data-done={s.done || undefined}>
                        <span className="nl-ready-tick" aria-hidden>
                          {s.done ? "✓" : ""}
                        </span>
                        {s.done ? (
                          <span className="nl-ready-label">{s.label}</span>
                        ) : (
                          <button
                            type="button"
                            className="nl-ready-fix"
                            onClick={() => goFix(s.fix)}
                          >
                            <span className="nl-ready-label">{s.label}</span>
                            <span className="nl-ready-go" aria-hidden>
                              →
                            </span>
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>

                  <fieldset className="nl-field">
                    <legend className="nl-label">Send</legend>
                    <div className="nl-seg" role="group" aria-label="When to send">
                      <button
                        type="button"
                        className="nl-seg-btn"
                        data-on={whenMode === "now"}
                        aria-pressed={whenMode === "now"}
                        onClick={() => {
                          setWhenMode("now");
                          setSchedule({ kind: "idle" });
                        }}
                      >
                        Now
                      </button>
                      <button
                        type="button"
                        className="nl-seg-btn"
                        data-on={whenMode === "later"}
                        aria-pressed={whenMode === "later"}
                        onClick={() => {
                          setWhenMode("later");
                          setSchedule({ kind: "idle" });
                        }}
                      >
                        Later
                      </button>
                    </div>
                    {whenMode === "later" && (
                      <>
                        <div className="nl-when-grid">
                          <label className="nl-field nl-field--tight">
                            <span className="nl-label">Date</span>
                            <input
                              className="nl-input"
                              type="date"
                              value={whenDate}
                              min={todayLocal()}
                              onChange={(e) => {
                                setWhenDate(e.target.value);
                                setSchedule({ kind: "idle" });
                              }}
                            />
                          </label>
                          <label className="nl-field nl-field--tight">
                            <span className="nl-label">Time</span>
                            <input
                              className="nl-input"
                              type="time"
                              value={whenTime}
                              onChange={(e) => {
                                setWhenTime(e.target.value);
                                setSchedule({ kind: "idle" });
                              }}
                            />
                          </label>
                        </div>
                        <p className="nl-when-readout" data-ok={when?.ok || undefined}>
                          {when?.text}
                        </p>
                      </>
                    )}
                  </fieldset>

                  <div className="nl-send-row">
                    <button
                      type="button"
                      className="nl-queue nl-send"
                      onClick={armSchedule}
                      disabled={
                        !ready ||
                        (whenMode === "later" && !(when && when.ok)) ||
                        schedule.kind === "working"
                      }
                    >
                      {schedule.kind === "working"
                        ? "Scheduling…"
                        : primaryLabel(whenMode, when)}
                    </button>
                    {/*
                      The test send, beside the primary rather than above it:
                      it is the thing to press first, and it is the only
                      action here that produces a real message without
                      committing anything. It needs a saved draft and the
                      postal address, not the whole list.
                    */}
                    <button
                      type="button"
                      className="nl-linkbtn"
                      onClick={sendTestToMyself}
                      disabled={
                        savedId === null ||
                        dirty ||
                        !canSendLegally ||
                        testSend.kind === "working"
                      }
                    >
                      {testSend.kind === "working" ? "Sending…" : "Send me a test first"}
                    </button>
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
                          <code>CAMPAIGN_DELIVERY_MODE=resend</code> to send for
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
                  {savedId !== null && !canSchedule(draft.status) && (
                    <p className="nl-help">
                      This campaign is{" "}
                      {STATUS_LABELS[draft.status].toLowerCase()} and can’t be
                      scheduled again.
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
export function AbortPanel({
  state,
  recipients,
  stalled,
  onAbort,
}: {
  state: AbortState;
  recipients: Record<RecipientStatus, number> | null;
  stalled: boolean;
  /** Called once the person has confirmed. The panel asks; the caller acts. */
  onAbort: () => void;
}) {
  const alreadySent =
    recipients === null
      ? null
      : recipients.sent +
        recipients.delivered +
        recipients.bounced +
        recipients.complained;

  /*
    ── THE QUESTION, IN THE PANEL ──
    This was a window.confirm until 8 Sep 2026. It qualified for the in-page
    pattern on every count — one call site, its own button, asynchronous —
    and it is the most consequential
    question in the product: it can strand part of a live audience. The
    numbers a person is deciding on belong beside the button they are about to
    press, not in the operating system's grey box.

    The text is still describeAbort's, so the number of people already mailed
    and still queued is the same wording the tests pin, split into paragraphs
    rather than joined with newlines a <p> would collapse. When the counts
    could not be read the question says so, because "we do not know how many"
    is a fact the person needs before pressing Stop.
  */
  const [confirming, setConfirming] = useState(false);
  const stopBtnRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      returnFocus.current = true;
      setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  useEffect(() => {
    if (confirming || !returnFocus.current) return;
    returnFocus.current = false;
    stopBtnRef.current?.focus();
  }, [confirming]);

  const question = (
    recipients !== null && alreadySent !== null
      ? describeAbort({ queued: recipients.queued, alreadySent })
      : "Stop this campaign for good?\n\nWe couldn’t read how many people have already been sent this, so this may stop a campaign that is part way through a live audience. Anyone already mailed cannot be un-mailed.\n\nThis cannot be undone. The campaign is marked Failed and can’t be edited, re-scheduled or sent again."
  ).split("\n\n");

  return (
    <>
      <p className="nl-note nl-note--warn" role="status">
        This campaign is <b>sending</b>. It can’t be edited, re-scheduled, or
        have its recipients changed — those rows are already being worked
        through.{" "}
        {stalled
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

      {confirming && (
        <div
          className="nl-confirm"
          role="alertdialog"
          aria-label="Stop this campaign"
          aria-describedby="nl-abort-q"
        >
          <div id="nl-abort-q">
            {question.map((para, i) => (
              <p className="nl-confirm-q" key={i}>
                {i === 0 ? <b>{para}</b> : para}
              </p>
            ))}
          </div>
          <div className="nl-confirm-acts">
            {/* Cancel first and focused, for the reason the unqueue confirm
                gives — and it matters more here, because the other button
                cannot be undone. */}
            <button
              type="button"
              className="nl-confirm-btn"
              autoFocus
              disabled={state.kind === "working"}
              onClick={() => {
                returnFocus.current = true;
                setConfirming(false);
              }}
            >
              Keep sending
            </button>
            <button
              type="button"
              className="nl-confirm-btn nl-confirm-btn--danger"
              disabled={state.kind === "working"}
              onClick={() => {
                returnFocus.current = true;
                setConfirming(false);
                onAbort();
              }}
            >
              Stop it for good
            </button>
          </div>
        </div>
      )}

      <div className="nl-queue-row">
        <button
          ref={stopBtnRef}
          type="button"
          className="nl-danger"
          onClick={() => setConfirming(true)}
          disabled={state.kind === "working" || confirming}
          aria-expanded={confirming}
        >
          {state.kind === "working" ? "Stopping…" : "Stop this campaign"}
        </button>
        <span className="nl-help">
          Ends the campaign for good and marks it <b>Failed</b>.{" "}
          {alreadySent === 0 ? (
            /*
              Stopping BEFORE anybody was reached is recoverable, and saying
              otherwise would frighten somebody out of the safe choice. The
              requeue panel appears afterwards precisely because nothing was
              delivered — see lib/campaign-requeue.ts.
            */
            <>
              Nobody has been reached yet, so afterwards you can put the
              recipients back and return this to draft.
            </>
          ) : (
            <>
              There is no way to finish the send afterwards, and the people
              already mailed cannot be un-mailed.
            </>
          )}
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
}: {
  state: AudienceState;
}) {
  if (state.kind === "unsaved") {
    return <p className="nl-help">Save the draft to count its audience.</p>;
  }

  if (state.kind === "no_list") {
    // Kept as a state because the audience route can still report it for an
    // older campaign; there is no list to choose any more, so it reads as the
    // empty audience it actually is.
    return <p className="nl-help">Nobody has confirmed a subscription yet.</p>;
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
        suppressions, duplicates and anyone unsubscribed.
      </p>

      {skips.length > 0 && (
        <ul className="nl-skips">
          {skips.map((r) => (
            <li key={r} className="nl-skip">
              <span className="nl-skip-n">
                {data.skipped[r].toLocaleString()}
              </span>
              <span className="nl-skip-l">{SKIP_LABELS[r]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Today as a `date` input value, in local time, for the field's `min`. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
