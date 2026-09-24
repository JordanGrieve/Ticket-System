"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CAMPAIGN_BODY_MAX,
  unfilledSlots,
  CAMPAIGN_NAME_MAX,
  CAMPAIGN_PREHEADER_MAX,
  CAMPAIGN_SUBJECT_MAX,
  NEWSLETTER_MERGE_TOKENS,
  TEMPLATE_KEYS,
  isEditableStatus,
  renderCampaign,
  safeImageUrl,
  unsubscribeUrl,
  type TemplateKey,
} from "@/lib/newsletter";
import type { CampaignHealth } from "@/lib/campaign-health";
import type { SweepSummary } from "@/lib/campaign-cron";
import { CAMPAIGN_TEMPLATES } from "@/lib/campaign-templates";
import { readinessSteps, readyToSend } from "@/lib/campaign-readiness";
import type { RecipientStatus } from "@/db/schema";
import { useDismiss } from "@/lib/use-dismiss";
import ProductsHeroEditor from "@/components/newsletter/ProductsHeroEditor";
import {
  STATUS_LABELS,
  blankProduct,
  draftFrom,
  emptyDraft,
  type AbortState,
  type ArmTarget,
  type AudienceJson,
  type AudienceState,
  type CampaignJson,
  type CampaignRowDTO,
  type Draft,
  type QueueState,
  type RequeueState,
  type ScheduleState,
} from "./composer-model";
import CampaignList, { type PendingNav } from "./CampaignList";
import AudienceReadout from "./AudienceReadout";
import PreviewCard from "./PreviewCard";
import RecipientsPanel from "./RecipientsPanel";
import SchedulePanel from "./SchedulePanel";

export type { CampaignRowDTO } from "./composer-model";

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
 *  - "Send now" arms the campaign, and the schedule route then runs ONE pass
 *    of the shared send loop (lib/campaign-sweep-run.ts, the code the cron
 *    calls) before returning. A later time is armed and left to the sweep;
 *  - every message goes to the provider named by `CAMPAIGN_DELIVERY_MODE`,
 *    which is `resend` in production;
 *  - the sweep runs at the cadence in SWEEP_CADENCE, see SWEEPS_PER_DAY
 *    (.github/workflows/campaign-sweep.yml), best-effort: GitHub delays or
 *    drops scheduled runs under load, and disables the workflow entirely after
 *    60 days with no commits;
 *  - "Send me a test first" mails the viewer and nobody else.
 *
 * Two things this comment used to list as blockers are now DONE, and are kept
 * here named rather than deleted so nobody re-adds them: marketing consent IS
 * enforced (selectAudience buckets `no_consent`), and the CAN-SPAM postal
 * address IS captured and enforced — `workspaces.postal_address` exists,
 * Settings writes it, and both this screen and the schedule route refuse to arm
 * a campaign without one.
 *
 * Each action is named for exactly what it does. "Queue recipients" writes
 * `campaign_recipients` rows. "Remove queued recipients" deletes them again —
 * it exists because queueing used to be a one-way door. The primary button
 * arms the campaign, and says whether that is now or at a time.
 *
 * ── NO INVENTED NUMBERS ──
 *
 * Every count on this page comes from GET /api/campaigns/:id/audience, which
 * runs `selectAudience` — the same function materialisation runs — so the
 * figure shown is suppression-adjusted and de-duplicated by the code that will
 * create the rows. Before a draft is saved with a list there is no count, and
 * the screen says there is no count rather than showing a plausible one.
 */

// ── Labels ───────────────────────────────────────────────────────

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  plain: "Plain — text on white, no framing",
  branded: "Branded — your workspace name above a card",
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
  welcomeEnabled,
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
  /**
   * Whether the welcome newsletter is sending. Shown on the pinned row so the
   * rail answers "is anything going out automatically?" without a click.
   */
  welcomeEnabled: boolean;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  /** The Delete button's second press. See destroy(). */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  /** What the server currently holds, which is what the count describes. */
  const [savedId, setSavedId] = useState<number | null>(null);
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
  /** Putting a wholly-failed campaign back in the queue. */
  const [requeue, setRequeue] = useState<RequeueState>({ kind: "idle" });

  const [schedule, setSchedule] = useState<ScheduleState>({ kind: "idle" });
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
  /** Which template this draft was started from. Presentational only. */
  const [startedFrom, setStartedFrom] = useState("blank");

  const subjectRef = useRef<HTMLInputElement>(null);
  const preheaderRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<FieldKey>("body");

  const editable = isEditableStatus(draft.status);

  // ── The count ──────────────────────────────────────────────────
  // Fetched for what the SERVER holds, never for the unsaved form: an audience
  // counted from an unsaved edit is a number for an email nobody will receive.
  //
  // `savedListId` is deliberately NOT in this key any more. It used to null the
  // key out entirely, which meant the request was never made for any campaign
  // with list_id NULL — i.e. for any campaign at all. The endpoint does not
  // read list_id either: `previewAudience` calls `workspaceAudience` and
  // ignores the column.
  const countKey =
    savedId === null ? null : `${savedId}:${audienceTick}`;

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
   * silently bin them. Two callers can do that — starting a new draft, and
   * selecting a different campaign — and neither needs an ANSWER, only a way
   * to be RESUMED: each one records what it was about to do, returns, and the
   * panel in the rail replays it with `force` if the person says discard.
   *
   * The rest of the pattern is the one the other confirms use: alertdialog,
   * the safe choice focused, Escape backs out, focus goes back to whatever was
   * pressed. There are no browser-native dialogs in the client.
   */
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

  // Escape backs out; the listener only exists while there is a question.
  useDismiss(pendingNav !== null, keepEditing);

  /** `force` is the panel replaying a parked call after "Discard changes". */
  function startNew(force = false) {
    if (!force && !guardNavigation({ kind: "new" })) return;
    setDraft(emptyDraft());
    setStartedFrom("blank");
    setSavedId(null);
    setDirty(false);
    setSaved(false);
    setError(null);
    setQueue({ kind: "idle" });
    setSchedule({ kind: "idle" });
  }

  /**
   * Copy this campaign into a new draft and open it.
   *
   * ── IT ASKS THE SERVER FOR THE COPY ──
   * Rather than posting the fields currently on screen. Two reasons, and the
   * second is the one that matters: the open campaign may have unsaved edits,
   * so "duplicate" would otherwise copy something that was never sent; and the
   * server builds the copy through `draftColumns`, whose `satisfies` means a
   * field added to a campaign later cannot be silently dropped from a copy.
   * The client would have to be remembered to update, and it would not be.
   *
   * No unsaved-changes guard: nothing here is discarded. The current draft is
   * left exactly as it is, and `open()` runs its own guard before replacing it.
   */
  async function duplicate() {
    if (savedId === null || duplicating) return;
    setDuplicating(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${savedId}/duplicate`, {
        method: "POST",
      });
      const payload = (await res.json()) as {
        campaign?: { id: number };
        error?: string;
      };
      if (!res.ok || !payload.campaign) {
        setError(payload.error ?? "Couldn’t duplicate that campaign.");
        return;
      }
      await refreshList();
      // Straight into the copy. Duplicating in order to change something means
      // the next act is editing it, and leaving the sent original open would
      // put the locked banner in front of somebody who had just asked for a
      // way past it.
      await open(payload.campaign.id, true);
    } catch {
      setError("Couldn’t reach the server.");
    } finally {
      setDuplicating(false);
    }
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
   * Re-read the server's diagnosis of this campaign.
   *
   * ── WHY THIS EXISTS ──
   * `health` and `recipients` were set in exactly one place — open() — so every
   * action taken afterwards left them describing a campaign that no longer
   * existed. Queue three recipients and the panel went on saying "Nobody is
   * queued to receive this yet. Queue the recipients…" directly beneath a line
   * reading "3 recipient rows created. 3 in total, all sitting at queued".
   * Jordan, 14 Sep 2026, after sending his first campaign: "that was a bit
   * confusing." It was: the screen contradicted itself, and the half telling
   * him what to do next was the half that was wrong.
   *
   * ONLY `health` and `recipients`. Re-opening the campaign would also replace
   * the draft, and this runs after actions somebody takes mid-edit — it would
   * throw away whatever they had typed since.
   */
  async function refreshDiagnosis(id: number) {
    try {
      const res = await fetch(`/api/campaigns/${id}`);
      const payload = (await res.json()) as {
        health?: CampaignHealth;
        recipients?: Record<RecipientStatus, number>;
      };
      if (!res.ok) return;
      setHealth(payload.health ?? null);
      setRecipients(payload.recipients ?? null);
    } catch {
      // Best effort, and deliberately silent: the action it follows has
      // already succeeded and said so. An error here would report a failure
      // that did not happen.
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
      await Promise.all([refreshList(), refreshDiagnosis(savedId)]);
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
   * rotation. The question itself is RecipientsPanel's.
   */
  async function discardRecipients() {
    if (savedId === null || queue.kind === "working") return;

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
      await Promise.all([refreshList(), refreshDiagnosis(savedId)]);
    } catch {
      setQueue({ kind: "error", message: "Couldn’t reach the server." });
    }
  }

  /**
   * Arm the campaign: draft → scheduled.
   *
   * ONE request for both modes. "Now" simply omits `scheduledAt`, and the
   * server resolves that to `now` and runs one send pass inline; a picked time
   * is sent as an ISO instant so the server is never guessing at a timezone.
   * SchedulePanel resolves the picked time; an unusable one arrives here as
   * `ok: false` and is reported like any other refusal.
   */
  async function armSchedule(target: ArmTarget) {
    if (savedId === null || schedule.kind === "working") return;

    if (!target.ok) {
      setSchedule({ kind: "error", message: target.text });
      return;
    }
    const scheduledAt = target.iso;

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
        sent?: SweepSummary | null;
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
      setSchedule({
        kind: "armed",
        immediate: payload.immediate === true,
        sent: payload.sent ?? null,
      });
      await Promise.all([refreshList(), refreshDiagnosis(savedId)]);
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
      setSchedule({ kind: "cancelled" });
      await Promise.all([refreshList(), refreshDiagnosis(savedId)]);
    } catch {
      setSchedule({ kind: "error", message: "Couldn’t reach the server." });
    }
  }

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
  /*
    ── WHICH CARD A READINESS STEP IS POINTING AT ──

    Pressing a step scrolled to the right card and stopped there, which on a
    long page means arriving somewhere plausible with no idea which of the
    three things in front of you was the one being asked for. Jordan,
    14 Sep 2026: "make it so you can click on the little tasks above the send
    button that will take you to the right tab and hover the box until you do
    what its asking."

    The marker persists rather than flashing — it stays until the step it names
    is satisfied, which is the "until you do what it's asking" half and the
    reason this is not a two-second animation.

    DERIVED, not cleared by an effect. `setChasing(null)` inside a useEffect
    watching `steps` is a setState-in-effect (the lint rule is right: it is a
    value, not a side effect). A key that no longer matches an unfinished step
    simply stops applying, so there is nothing to clear.
  */
  const [chasing, setChasing] = useState<
    "save" | "signup" | "queue" | "body" | "settings" | null
  >(null);

  const steps = readinessSteps({
    saved: savedId !== null,
    dirty,
    audienceCount: audience.kind === "ready" ? audience.data.recipientCount : null,
    queued: draft.recipientCount,
    placeholders: slots.length,
    postalAddress: canSendLegally,
  });
  const chasingUnfinished =
    chasing !== null && steps.some((s) => s.fix === chasing && !s.done)
      ? chasing
      : null;
  const ready = readyToSend(steps, draft.status);

  /** Where each unmet step is fixed. Focus or scroll; never a page change except Settings. */
  function goFix(fix: (typeof steps)[number]["fix"]) {
    // Marked BEFORE the scroll, so the ring is already on the card when it
    // arrives rather than appearing a moment later under the eye.
    setChasing(fix);

    if (fix === "save") {
      save();
    } else if (fix === "signup") {
      // Nobody has confirmed yet. The fix is the signup form, which lives on
      // the Install screen — not anything on this page.
      window.location.assign("/settings/install");
    } else if (fix === "queue") {
      document.getElementById("nl-recipients")?.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (fix === "body") {
      bodyRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      bodyRef.current?.focus();
    } else {
      window.location.assign("/settings");
    }
  }

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
      <CampaignList
        campaigns={campaigns}
        currentId={draft.id}
        loadingId={loadingId}
        pendingNav={pendingNav}
        welcomeEnabled={welcomeEnabled}
        // Not `onNew={startNew}`: an argument would arrive as `force`.
        onNew={() => startNew()}
        onOpen={(id) => void open(id)}
        onKeepEditing={keepEditing}
        onDiscardAndGo={discardAndGo}
      />

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
            {/*
              The way FORWARD from the lock.

              A sent campaign cannot be edited, and should not be: the row is
              what a client's customers were told. Until this button the only
              route from "send it again with a change" was retyping the whole
              thing, which made a correct rule read as an obstacle — Jordan,
              14 Sep 2026: "I can't resend another email if I change it? Why is
              it locked?"

              Offered on any SAVED campaign rather than only a sent one:
              copying a draft to try a second subject line is the same wish
              arriving earlier.
            */}
            {draft.id !== null && (
              <button
                type="button"
                className="nl-duplicate"
                onClick={duplicate}
                disabled={duplicating}
                aria-label={`Duplicate ${draft.name || "this campaign"} as a new draft`}
              >
                {duplicating ? "Duplicating…" : "Duplicate"}
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

              <ProductsHeroEditor
                heroImageUrl={draft.heroImageUrl}
                heroImageAlt={draft.heroImageAlt}
                products={draft.products}
                disabled={!editable}
                onChange={patch}
                newProduct={blankProduct}
              />

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

              <div
                className="nl-field"
                data-chasing={chasingUnfinished === "body" || undefined}
              >
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
                11 Sep 2026: one thank-you on signup, and then everyone.
              */}
              <AudienceReadout state={audience} />
            </section>
          </div>

          {/* ── Right: preview + the honest bit ──────────────── */}
          <div className="nl-col">
            <PreviewCard rendered={rendered} preheader={draft.preheader} />

            {/* ── What queueing does, and does not do ────────── */}
            <RecipientsPanel
              savedId={savedId}
              status={draft.status}
              dirty={dirty}
              recipientCount={draft.recipientCount}
              queue={queue}
              chasing={chasingUnfinished === "queue"}
              onQueue={queueRecipients}
              onDiscard={discardRecipients}
            />

            {/* ── The draft ⇄ scheduled edge ─────────────────── */}
            <SchedulePanel
              savedId={savedId}
              status={draft.status}
              dirty={dirty}
              recipientCount={draft.recipientCount}
              scheduledAtIso={draft.scheduledAtIso}
              recipientsPerSweep={recipientsPerSweep}
              health={health}
              recipients={recipients}
              abort={abort}
              onAbort={abortSend}
              requeue={requeue}
              onRequeue={requeueFailed}
              schedule={schedule}
              onScheduleReset={() => setSchedule({ kind: "idle" })}
              onArm={armSchedule}
              onCancelSchedule={cancelSchedule}
              steps={steps}
              ready={ready}
              onFix={goFix}
              canSendLegally={canSendLegally}
              viewerEmail={viewerEmail}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
