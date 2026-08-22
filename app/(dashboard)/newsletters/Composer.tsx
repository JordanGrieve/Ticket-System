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
  canCancelSchedule,
  canDiscardRecipients,
  canSchedule,
  describeDrain,
} from "@/lib/campaign-schedule";

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
 *  - the sweep runs ONCE A DAY (vercel.json `0 3 * * *`; the Hobby plan
 *    refuses a sub-daily expression), so throughput is ~75 recipients per DAY;
 *  - consent is still not enforced anywhere, and CAN-SPAM requires a physical
 *    postal address in every message that `workspaces` has no column for.
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

/** Where clients start truncating the subject in the inbox list. */
const SUBJECT_DISPLAY_LIMIT = 70;

type FieldKey = "subject" | "preheader" | "body";

// ── Component ────────────────────────────────────────────────────

export default function Composer({
  initialCampaigns,
  lists,
  workspaceName,
  appUrl,
  viewerEmail,
  recipientsPerSweep,
}: {
  initialCampaigns: CampaignRowDTO[];
  lists: ListOption[];
  workspaceName: string;
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
        error?: string;
      };
      if (!res.ok || !payload.campaign) {
        setError(payload.error ?? "Couldn’t open that campaign.");
        return;
      }
      setDraft(draftFrom(payload.campaign));
      setSavedId(payload.campaign.id);
      setSavedListId(payload.campaign.listId);
      setDirty(false);
      setSaved(false);
      setQueue({ kind: "idle" });
      setSchedule({ kind: "idle" });
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
      }),
    [
      draft.subject,
      draft.preheader,
      draft.templateKey,
      draft.body,
      workspaceName,
      appUrl,
    ],
  );

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
                <b>roughly every five minutes</b> — that cadence is best effort,
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

              {draft.status === "scheduled" ? (
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
                        ? "Scheduled for now, which means the next daily sweep."
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
                      Your local time. Either way the campaign waits for the
                      daily sweep, so “as soon as possible” means “at the next
                      03:00 UTC run”, not immediately.
                    </p>
                  </fieldset>

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
