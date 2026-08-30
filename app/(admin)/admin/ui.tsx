import type { WorkspaceSummary } from "@/lib/data";
import { workspaceHealth } from "@/lib/workspace-health";

/**
 * Shared pieces for the admin console: the query model that drives navigation,
 * the status vocabulary, and the small presentational atoms.
 *
 * Everything here is a Server Component. The console has no client JavaScript —
 * section switching, filtering, search and drawer selection are all URL state,
 * which keeps it compatible with the Server Actions that do the real work.
 */

export const SECTIONS = [
  "accounts",
  "overview",
  "access",
  "billing",
  "deliverability",
  "support",
] as const;

export type Section = (typeof SECTIONS)[number];

export const FILTERS = [
  "all",
  // Not an AccountStatus — a view over the two that mean "go and look".
  // First in the list because it is the only tab with a deadline attached.
  "attention",
  "active",
  "invited",
  "quiet",
] as const;

/** True when this account is one somebody should investigate. */
export function needsAttention(w: WorkspaceSummary, now: Date = new Date()): boolean {
  const s = accountStatus(w, now);
  return s === "never_received" || s === "gone_quiet";
}

export type Filter = (typeof FILTERS)[number];

export type AdminQuery = {
  section: Section;
  filter: Filter;
  q: string;
  account: number | null;
};

/** Build a /admin URL from the current query plus an override. */
export function hrefFor(
  current: AdminQuery,
  patch: Partial<AdminQuery> = {},
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.section !== "accounts") params.set("section", next.section);
  if (next.filter !== "all") params.set("filter", next.filter);
  if (next.q) params.set("q", next.q);
  if (next.account !== null) params.set("account", String(next.account));
  const qs = params.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

/**
 * The account statuses this pill renders, and why they are not the billing
 * ones the design asked for.
 *
 * The design asked for Active / Trial / Past due / Churn risk. Three of those
 * describe a billing relationship, and — unlike when this comment was first
 * written — the product now has one: every workspace carries a plan, a Stripe
 * subscription status and a paid-through date, all written by the billing
 * webhook. So they are renderable. They are still deliberately not rendered
 * HERE.
 *
 * One pill can only answer one question, and this one answers "is this
 * client's Postbox working?" — is mail arriving, is anyone reading it. Billing
 * answers "are they paying?". Folding the two together means a workspace whose
 * contact form has been dead for six weeks shows "Past due", and the outage
 * that this pill exists to surface disappears behind an invoice problem. That
 * is the exact failure it was rewritten to prevent, arriving by a new route.
 *
 * Billing state therefore gets its own column in the accounts table and its
 * own pane, where it can say Trial / comped / period ended without competing
 * for the same square of screen.
 *
 * ── WHY THIS IS NO LONGER A ONE-LINER ──
 * It used to be `totalCount > 0 ? "active" : "quiet"`, and "quiet" rendered in
 * muted grey as "No enquiries yet". Open Door Bakery sat in that state for six
 * weeks with a contact form that was returning 401 to every visitor, and the
 * screen said the reassuring thing the whole time. It was found because the
 * client complained.
 *
 * Silence and breakage are not the same state and must not share a pill. The
 * judgement now lives in lib/workspace-health.ts, which compares a workspace
 * against its OWN rate — see its header for why a fixed threshold would just
 * teach the operator to ignore the badge.
 */
export type AccountStatus =
  | "active"
  | "invited"
  | "quiet"
  | "never_received"
  | "gone_quiet";

export function accountStatus(
  w: WorkspaceSummary,
  now: Date = new Date(),
): AccountStatus {
  const health = workspaceHealth({
    pending: w.pending,
    createdAt: w.createdAt,
    totalCount: w.totalCount,
    firstTicketAt: w.firstTicketAt,
    lastTicketAt: w.lastTicketAt,
    now,
  });
  switch (health.state) {
    case "invited":
      return "invited";
    case "settling":
      return "quiet";
    case "never_received":
      return "never_received";
    case "gone_quiet":
      return "gone_quiet";
    case "healthy":
      return "active";
  }
}

const STATUS_LABEL: Record<AccountStatus, string> = {
  active: "Active",
  invited: "Awaiting sign-in",
  quiet: "No enquiries yet",
  // Phrased as the thing to check, not as a diagnosis. The operator cannot see
  // the client's site from here, and "broken" would be a claim this screen
  // cannot support.
  never_received: "Never received anything",
  gone_quiet: "Gone quiet",
};

const STATUS_TONE: Record<AccountStatus, PillTone> = {
  active: "ok",
  invited: "warn",
  quiet: "muted",
  // RISK, not muted. The entire failure was that this state looked calm.
  never_received: "risk",
  gone_quiet: "risk",
};

export type PillTone = "ok" | "accent" | "warn" | "risk" | "muted";

export function Pill({
  tone,
  children,
}: {
  tone: PillTone;
  children: React.ReactNode;
}) {
  return <span className={`pba-pill pba-pill-${tone}`}>{children}</span>;
}

export function StatusPill({ status }: { status: AccountStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

export function Kpi({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="pba-kpi">
      <div className="pba-kpi-label">{label}</div>
      <div className="pba-kpi-value">{value}</div>
      {note && <div className="pba-kpi-note">{note}</div>}
    </div>
  );
}

/** The four KPIs, every one of them counted from real rows. */
export function KpiGrid({ accounts }: { accounts: WorkspaceSummary[] }) {
  const total = accounts.reduce((n, w) => n + w.totalCount, 0);
  const open = accounts.reduce((n, w) => n + w.openCount, 0);
  const invited = accounts.filter((w) => w.pending).length;
  return (
    <div className="pba-kpis">
      <Kpi
        label="Workspaces"
        value={accounts.length}
        note={`${accounts.length - invited} signed in`}
      />
      <Kpi label="Enquiries" value={total} note="All time, every workspace" />
      <Kpi
        label="Open enquiries"
        value={open}
        note={total ? `${Math.round((open / total) * 100)}% of all enquiries` : "Nothing logged yet"}
      />
      <Kpi
        label="Awaiting sign-in"
        value={invited}
        note={invited ? "Invite sent, never used" : "Every client has signed in"}
      />
    </div>
  );
}

/**
 * The honest empty state. Used wherever the design asked for something the
 * product has no data source for. It names the missing feature rather than
 * showing a plausible-looking zero, because a zero reads as a measurement.
 */
export function NotBuilt({
  title,
  text,
  missing,
  small,
}: {
  title: string;
  text: string;
  missing?: string[];
  small?: boolean;
}) {
  return (
    <div className={small ? "pba-empty pba-empty-sm" : "pba-empty"}>
      <span className="pba-empty-tag">Not built yet</span>
      <p className="pba-empty-title">{title}</p>
      <p className="pba-empty-text">{text}</p>
      {missing && missing.length > 0 && (
        <ul className="pba-empty-list">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Deterministic date formatting — same string on the server and in any locale. */
export function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Date *and* time, UTC, for the access log. "14 Aug 2026" is useless when the
 * question is which of two visits read a particular message, and a local-zone
 * render would disagree between the server and whoever reads it, so the zone
 * is stated rather than assumed.
 */
export function formatDateTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d)} UTC`;
}

/** Coarse elapsed time between two instants — "4 min", "1 h 12 min". */
export function formatDuration(
  from: Date | string,
  to: Date | string,
): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </svg>
  );
}

/** Envelope for the sidebar brand tile — white on the accent gradient. */
export function EnvelopeIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <rect x="2.5" y="4.75" width="19" height="14.5" rx="3" />
      <path d="M3.5 7.5l7.3 5.1a2 2 0 002.4 0l7.3-5.1" />
    </svg>
  );
}
