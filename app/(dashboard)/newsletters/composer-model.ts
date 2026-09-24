import type { CampaignProduct, CampaignStatus } from "@/db/schema";
import type { SweepSummary } from "@/lib/campaign-cron";
import {
  STARTER_CAMPAIGN_BODY,
  TEMPLATE_KEYS,
  type AudienceSkipReason,
  type TemplateKey,
} from "@/lib/newsletter";
import {
  blankDraftProduct,
  draftProductFrom,
  type DraftProduct,
} from "@/components/newsletter/ProductsHeroEditor";

/**
 * The composer's shapes: what the wire carries, what the form holds, and the
 * labels every panel of it shares. Split out of Composer.tsx so the panels in
 * this folder can name the same states without importing the component.
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
export type CampaignJson = {
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

export type AudienceJson = {
  recipientCount: number;
  candidateCount: number;
  skipped: Record<AudienceSkipReason, number>;
  skippedTotal: number;
};

/*
 * ── THERE IS NO "no_list" STATE ANY MORE, AND THAT IS THE POINT ──
 *
 * There used to be, and it was load-bearing in the worst way. Lists were
 * retired — a campaign goes to everyone confirmed in the workspace, which is
 * what `workspaceAudience` selects — so every campaign created since has
 * `list_id` NULL. Four places still keyed off that column, and together they
 * made every campaign in the product unsendable: the count was never
 * requested, the panel said "Nobody has confirmed a subscription yet" to
 * workspaces with confirmed subscribers, "Queue recipients" was permanently
 * disabled, and the help text under it told the client to choose a list from
 * a picker that no longer exists.
 *
 * Removing the member from this union is what found all four — each one
 * stopped compiling. That is the reason it is a union member and not a
 * boolean: the same retirement had already left `list_id IS NOT NULL` in
 * scheduleCampaign, where nothing could catch it and nothing did until
 * somebody ran the whole journey by hand (tests/campaign-arming.test.ts).
 */
export type AudienceState =
  | { kind: "unsaved" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AudienceJson };

export type QueueState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "done"; inserted: number; total: number }
  | { kind: "discarded"; deleted: number; total: number };

/** The draft ⇄ scheduled edge, as the screen sees it. */
export type ScheduleState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | {
      kind: "armed";
      immediate: boolean;
      /** The inline pass's own counts, or null when there was not one. */
      sent: SweepSummary | null;
    }
  | { kind: "cancelled" };

/**
 * The sending → failed edge. SEPARATE state from `schedule`, and separate on
 * purpose: sharing one state would let "Schedule cancelled. This campaign is a
 * draft again" render after an abort, which is the single most dangerous
 * sentence this screen could get wrong.
 */
export type AbortState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "stopped"; stopped: number; alreadySent: number };

export type RequeueState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string };

/** A picked send time, already checked by describeWhen — or why it failed. */
export type ArmTarget = { ok: true; iso: string | null } | { ok: false; text: string };

// ── Local draft ──────────────────────────────────────────────────

export type Draft = {
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
  /** Products, as authored — see DraftProduct. Converted on save. */
  products: DraftProduct[];
  status: CampaignStatus;
  /**
   * Server-held counts and times. Written only from a server response, never
   * by `patch()` — they describe what the database holds, not the form.
   */
  recipientCount: number;
  scheduledAtIso: string | null;
};

let nextProductId = 1;

export function blankProduct(): DraftProduct {
  return blankDraftProduct(nextProductId++);
}

export function emptyDraft(): Draft {
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

export function draftFrom(c: CampaignJson): Draft {
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
    products: (c.products ?? []).map((p) => draftProductFrom(p, nextProductId++)),
    status: c.status,
    recipientCount: c.recipientCount,
    scheduledAtIso: c.scheduledAt,
  };
}

// ── Labels ───────────────────────────────────────────────────────

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

export const SKIP_LABELS: Record<AudienceSkipReason, string> = {
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
