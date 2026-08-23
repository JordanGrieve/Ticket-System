import Link from "next/link";
import type { Admin, ImpersonationEnd, ImpersonationSession } from "@/db/schema";
import type { WorkspaceSummary } from "@/lib/data";
import type { IngestionFailureRow } from "@/lib/ingestion-log";
import {
  sessionState,
  sessionStates,
  type SessionState,
} from "@/lib/impersonation";
import "../access-log.css";
import {
  addAdminAction,
  createClientAction,
  deleteClientAction,
  removeAdminAction,
  resendInviteAction,
  selectWorkspaceAction,
} from "./actions";
import {
  accountStatus,
  needsAttention,
  formatDate,
  formatDateTime,
  formatDuration,
  hrefFor,
  KpiGrid,
  NotBuilt,
  Pill,
  StatusPill,
  type AdminQuery,
  type Filter,
  type PillTone,
} from "./ui";

/* ────────────────────────────────────────────────────────────────────────
   ACCOUNTS
   ──────────────────────────────────────────────────────────────────────── */

const TABS: { key: Filter; label: string }[] = [
  { key: "all", label: "All accounts" },
  // Second, and named as an instruction rather than a state. This tab exists
  // because Open Door Bakery sat under "No enquiries yet" for six weeks with a
  // broken contact form and nothing ever asked anyone to look.
  { key: "attention", label: "Needs a look" },
  { key: "active", label: "Active" },
  { key: "invited", label: "Awaiting sign-in" },
  { key: "quiet", label: "No enquiries yet" },
];

export function AccountsSection({
  accounts,
  visible,
  query,
  deleteTarget,
}: {
  /** Every workspace, for the KPI row and the tab counts. */
  accounts: WorkspaceSummary[];
  /** The rows that survive the search box and the active tab. */
  visible: WorkspaceSummary[];
  query: AdminQuery;
  deleteTarget: WorkspaceSummary | null;
}) {
  const countFor = (f: Filter) => {
    if (f === "all") return accounts.length;
    if (f === "attention") return accounts.filter((w) => needsAttention(w)).length;
    return accounts.filter((w) => accountStatus(w) === f).length;
  };

  return (
    <>
      {deleteTarget && <DeletePanel target={deleteTarget} />}

      <KpiGrid accounts={accounts} />

      <div className="pba-tabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(query, { filter: t.key })}
            className={`pba-tab${query.filter === t.key ? " is-active" : ""}`}
          >
            {t.label}
            <span>{countFor(t.key)}</span>
          </Link>
        ))}
      </div>

      <div className="pba-table">
        <div className="pba-scroll">
          <div className="pba-grid">
            <div className="pba-thead">
              <div className="pba-row pba-row-accounts pba-th">
                <div>Company</div>
                <div>Owner</div>
                <div>Enquiries</div>
                <div>Open</div>
                <div>Created</div>
                <div>Status</div>
              </div>
            </div>
            <div className="pba-tbody">
              {visible.length === 0 && (
                <div className="pba-row">
                  <div className="pba-td">
                    {accounts.length === 0
                      ? "No client workspaces yet — create the first one below."
                      : "No accounts match that search or filter."}
                  </div>
                </div>
              )}
              {visible.map((w) => (
                <Link
                  key={w.id}
                  href={hrefFor(query, { account: w.id })}
                  className={`pba-rowlink${query.account === w.id ? " is-selected" : ""}`}
                >
                  <div className="pba-row pba-row-accounts">
                    <div>
                      <div className="pba-cell-main">{w.name}</div>
                      <div className="pba-cell-sub">{w.inboundEmail}</div>
                    </div>
                    <div className="pba-td">{w.ownerEmail ?? "—"}</div>
                    <div className="pba-num">{w.totalCount}</div>
                    <div className="pba-num">{w.openCount}</div>
                    <div className="pba-td">{formatDate(w.createdAt)}</div>
                    <div>
                      <StatusPill status={accountStatus(w)} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="pba-note">
        The design for this table asked for <b>Plan</b>, <b>Subscribers</b> and{" "}
        <b>MRR</b> columns. <b>Plan</b> and <b>MRR</b> have nothing behind them:
        there is no billing and no subscription record anywhere in the schema.{" "}
        <b>Subscribers</b> is different &mdash; a per-workspace{" "}
        <code>subscribers</code> table exists, with lists and campaigns beside
        it, so the count is computable. It is simply not queried here yet.
        Those columns are replaced above by figures that are actually measured.
      </p>

      <div className="pba-card" id="new-account">
        <div className="pba-card-head">
          <h2 className="pba-card-title">New account</h2>
          <p className="pba-card-sub">
            Creates the workspace now and emails an invite. When the client signs
            up with this address they land straight in it.
          </p>
        </div>
        <form action={createClientAction} className="pba-form">
          <input
            type="text"
            name="name"
            required
            placeholder="Business name — e.g. Open Door Bakery"
            className="pba-input pba-input-grow"
          />
          <input
            type="email"
            name="email"
            required
            placeholder="Client login email"
            className="pba-input pba-input-grow"
          />
          <button type="submit" className="pba-btn pba-btn-primary">
            Create workspace
          </button>
        </form>
      </div>
    </>
  );
}

/** Type-the-name confirmation before a workspace is destroyed. */
function DeletePanel({ target }: { target: WorkspaceSummary }) {
  return (
    <div className="pba-danger-panel">
      <p className="pba-danger-title">Permanently delete {target.name}?</p>
      <p className="pba-danger-text">
        This erases the workspace and everything in it —{" "}
        <b>
          {target.totalCount} enquir{target.totalCount === 1 ? "y" : "ies"}
        </b>
        , all message history, and its contacts. It cannot be undone. To confirm,
        type the workspace name exactly: <b>{target.name}</b>
      </p>
      <form action={deleteClientAction} className="pba-form">
        <input type="hidden" name="workspaceId" value={target.id} />
        <input
          type="text"
          name="confirmName"
          required
          autoComplete="off"
          placeholder={`Type "${target.name}" to confirm`}
          className="pba-input pba-input-grow"
        />
        <button type="submit" className="pba-btn pba-btn-danger">
          Permanently delete
        </button>
        <Link href="/admin" className="pba-btn">
          Cancel
        </Link>
      </form>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   OVERVIEW
   ──────────────────────────────────────────────────────────────────────── */

export function OverviewSection({ accounts }: { accounts: WorkspaceSummary[] }) {
  const newest = [...accounts]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 6);

  return (
    <>
      <KpiGrid accounts={accounts} />
      <div className="pba-cols">
        <div className="pba-col-main">
          <div className="pba-card">
            <div className="pba-card-head">
              <h2 className="pba-card-title">Revenue by plan</h2>
              <p className="pba-card-sub">
                What every account is worth, broken down by the plan it is on.
              </p>
            </div>
            <NotBuilt
              title="Postbox does not charge anyone yet"
              text="There are no plans, no prices and no payment provider connected, so there is no revenue to break down. This card stays empty until billing is built — it will not estimate."
              missing={["Plans", "Prices", "Subscriptions", "Payment provider"]}
            />
          </div>
        </div>
        <div className="pba-col-side">
          <div className="pba-card">
            <div className="pba-card-head">
              <h2 className="pba-card-title">Newest workspaces</h2>
              <p className="pba-card-sub">Most recently created, from the database.</p>
            </div>
            <div className="pba-list">
              {newest.length === 0 && (
                <div className="pba-list-row">No workspaces yet.</div>
              )}
              {newest.map((w) => (
                <div key={w.id} className="pba-list-row">
                  <div className="pba-list-main">
                    <div className="pba-list-name">{w.name}</div>
                    <div className="pba-list-sub">
                      {formatDate(w.createdAt)} · {w.ownerEmail ?? w.inboundEmail}
                    </div>
                  </div>
                  <StatusPill status={accountStatus(w)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   ACCESS LOG
   ──────────────────────────────────────────────────────────────────────── */

const END_LABEL: Record<ImpersonationEnd, string> = {
  stopped: "Stopped",
  switched: "Switched client",
  workspace_deleted: "Workspace deleted",
  admin_removed: "Admin access revoked",
};

const STATE_TONE: Record<SessionState, PillTone> = {
  active: "accent",
  abandoned: "risk",
  ended: "muted",
};

/**
 * What a row's end state actually is. An ended row says how it ended; an open
 * one says either "in progress" or "abandoned", and never pretends to know an
 * end time it was never told.
 */
function StatePill({ state, session }: { state: SessionState; session: ImpersonationSession }) {
  const label =
    state === "ended"
      ? session.endedReason
        ? END_LABEL[session.endedReason]
        : "Ended"
      : state === "active"
        ? "In progress"
        : "Abandoned";
  return <Pill tone={STATE_TONE[state]}>{label}</Pill>;
}

/**
 * How long the operator was in there.
 *
 * Only a closed session has a real duration. For everything else this reports
 * a floor — start to last-seen — and says it is a floor, because the operator
 * could have sat on an open page for an hour after the last request we saw.
 */
function duration(session: ImpersonationSession, state: SessionState): string {
  if (state === "ended" && session.endedAt) {
    return formatDuration(session.startedAt, session.endedAt);
  }
  return `${formatDuration(session.startedAt, session.lastSeenAt)}+`;
}

export function AccessSection({ sessions }: { sessions: ImpersonationSession[] }) {
  const states = sessionStates(sessions);
  const open = states.filter((s) => s === "active").length;
  const abandoned = states.filter((s) => s === "abandoned").length;

  return (
    <div className="pba-stack">
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Operator access to client data</h2>
          <p className="pba-card-sub">
            Every time someone from Postbox entered a client workspace. Our
            clients are the data controllers and we are their processor, so this
            is the record we owe them when they ask who read their customers&rsquo;
            messages. It is append-only — nothing in this console can remove a
            row, including your own.
          </p>
        </div>

        <div className="pba-tiles">
          <div className="pba-tile">
            <div className="pba-tile-value">{sessions.length}</div>
            <div className="pba-tile-label">Recorded visits</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">{open}</div>
            <div className="pba-tile-label">Happening now</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">{abandoned}</div>
            <div className="pba-tile-label">Never closed</div>
          </div>
        </div>
      </div>

      <div className="pba-table">
        <div className="pba-scroll">
          <div className="pba-grid pba-grid-access">
            <div className="pba-thead">
              <div className="pba-row pba-row-access pba-th">
                <div>Operator</div>
                <div>Workspace</div>
                <div>Started</div>
                <div>Duration</div>
                <div>Reason given</div>
                <div>State</div>
              </div>
            </div>
            <div className="pba-tbody">
              {sessions.length === 0 && (
                <div className="pba-row">
                  <div className="pba-td">
                    No operator has entered a client workspace since access
                    logging was switched on. Visits made before that were not
                    recorded and cannot be reconstructed.
                  </div>
                </div>
              )}
              {sessions.map((s, i) => {
                const state = states[i];
                return (
                  <div key={s.id} className="pba-row pba-row-access">
                    <div>
                      <div className="pba-cell-main">{s.adminEmail}</div>
                      <div className="pba-cell-sub">
                        {s.adminId === null
                          ? "no longer an admin"
                          : (s.adminClerkUserId ?? "no login linked")}
                      </div>
                    </div>
                    <div>
                      <div className="pba-cell-main">{s.workspaceName}</div>
                      {s.workspaceId === null && (
                        <div className="pba-cell-sub">workspace since deleted</div>
                      )}
                    </div>
                    <div className="pba-td">{formatDateTime(s.startedAt)}</div>
                    <div className="pba-td">{duration(s, state)}</div>
                    <div className="pba-td">
                      {s.reason ?? <span className="pba-unset">none given</span>}
                    </div>
                    <div>
                      <StatePill state={state} session={s} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <p className="pba-note">
        A <b>+</b> on a duration means it is a lower bound. Nothing forces an
        operator to leave cleanly — they can close the tab — so a visit that was
        never stopped is timed from its start to the last request we actually
        saw from it, and marked <b>Abandoned</b> once that goes quiet. The gap
        between &ldquo;last seen&rdquo; and &ldquo;actually stopped looking&rdquo;
        is not measurable and is not guessed at here.
      </p>
      <p className="pba-note">
        This log records <b>entry into a workspace</b>, not individual reads. It
        cannot tell you which tickets were opened or which customer&rsquo;s
        details were on screen — no per-record access is captured anywhere in
        Postbox. It also does not cover sign-ins, API-key traffic or anything
        done directly against the database.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   BILLING
   ──────────────────────────────────────────────────────────────────────── */

export function BillingSection() {
  return (
    <NotBuilt
      title="There is no billing system"
      text="No invoices exist to list, because nothing has ever been charged. Postbox has no plans, no prices, no payment provider and no invoice records. Anything this pane showed would be invented."
      missing={[
        "Invoices",
        "Plans & prices",
        "Payment provider",
        "Tax / VAT records",
        "Dunning state",
      ]}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────────
   DELIVERABILITY
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Why a submission was turned away, in the operator’s words rather than the
 * code’s. "invalid_key" is what the column holds; this is what it means.
 */
const REJECTION_LABELS: Record<string, string> = {
  invalid_key: "Key not recognised",
  missing_fields: "Incomplete submission",
  invalid_email: "Bad email address",
  honeypot: "Caught by spam trap",
};

export function DeliverabilitySection({
  accounts,
  rejections,
}: {
  accounts: WorkspaceSummary[];
  /** Aggregated rejected ingestion attempts. See lib/ingestion-log.ts. */
  rejections: IngestionFailureRow[];
}) {
  const byWorkspace = new Map(accounts.map((w) => [w.id, w.name]));
  return (
    <div className="pba-stack">
      {/*
        First, above the "nothing is measured" notice, because this IS measured
        and it is the thing that cost six weeks. Open Door Bakery's site posted
        a dead key every day and the 401s went nowhere.
      */}
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Rejected submissions</h2>
          <p className="pba-card-sub">
            Requests the public endpoints turned away, grouped by key. A high
            count against one key usually means a client&rsquo;s website is
            posting credentials we don&rsquo;t recognise &mdash; their form has
            been broken since whenever the count started.
          </p>
        </div>
        {rejections.length === 0 ? (
          <p className="pba-card-sub" style={{ padding: "0 18px 18px" }}>
            Nothing rejected. Either every integration is working, or none has
            been touched since this started being recorded on 23 August 2026.
          </p>
        ) : (
          <div className="pba-table">
            <div className="pba-scroll">
              <div className="pba-row pba-row-head">
                <span>Key</span>
                <span>Reason</span>
                <span>Workspace</span>
                <span>Count</span>
                <span>Last seen</span>
              </div>
              {rejections.map((r) => (
                <div className="pba-row" key={`${r.reason}:${r.keyPrefix}`}>
                  <span className="pba-mono">{r.keyPrefix}…</span>
                  <span>{REJECTION_LABELS[r.reason] ?? r.reason}</span>
                  <span>
                    {r.workspaceId === null
                      ? // An unknown key belongs to no workspace by definition.
                        "— unknown key"
                      : (byWorkspace.get(r.workspaceId) ?? `#${r.workspaceId}`)}
                  </span>
                  <span>{r.count}</span>
                  <span>{formatDate(r.lastSeenAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <NotBuilt
        title="Nothing about delivery is measured yet"
        text="The tables exist and almost nothing fills them. campaign_recipients holds a per-send row with status, sent_at, delivered_at, provider_message_id and error, and sending_domains holds per-workspace SPF/DKIM/DMARC state — but the only thing that ever fills those delivery columns is the nightly campaign sweep, which has never run against a live provider; no webhook exists to record a bounce or a complaint; and no row has ever been written to sending_domains at all. Transactional ticket replies are not logged at all: they go out through one shared provider and nothing records the result. So the four headline numbers this pane was designed around are unavailable because nothing populates the schema, not because the schema is missing."
        missing={[
          "Delivered / bounced counts",
          "Spam complaints",
          "SPF & DKIM records",
          "Per-account sending domains",
        ]}
      />

      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Configured addresses</h2>
          <p className="pba-card-sub">
            This much is real: the address each workspace receives mail on and the
            address its replies are sent from. Neither is a verified domain — no
            DNS is checked and no domain is owned per account.
          </p>
        </div>
        <div className="pba-table">
          <div className="pba-scroll">
            <div className="pba-grid">
              <div className="pba-thead">
                <div className="pba-row pba-row-domains pba-th">
                  <div>Account</div>
                  <div>Inbound address</div>
                  <div>Sending address</div>
                </div>
              </div>
              <div className="pba-tbody">
                {accounts.length === 0 && (
                  <div className="pba-row">
                    <div className="pba-td">No workspaces yet.</div>
                  </div>
                )}
                {accounts.map((w) => (
                  <div key={w.id} className="pba-row pba-row-domains">
                    <div className="pba-cell-main">{w.name}</div>
                    <div className="pba-td pba-mono">{w.inboundEmail}</div>
                    <div className="pba-td pba-mono">{w.sendingEmail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   SUPPORT
   ──────────────────────────────────────────────────────────────────────── */

export function SupportSection({
  admins,
  viewerEmail,
}: {
  admins: Admin[];
  viewerEmail: string;
}) {
  return (
    <div className="pba-stack">
      <NotBuilt
        title="Operators have no support queue"
        text="The designed ticket cards need a priority, an assignee and a ticket that belongs to Postbox rather than to a client. None of those exist — tickets are tenant-owned, have no priority field, and there is no channel for a client to raise anything with us."
        missing={["Operator tickets", "Priority", "Assignment", "SLA / response times"]}
      />

      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Postbox admins</h2>
          <p className="pba-card-sub">
            Admins see and act inside every client workspace. This is real and
            takes effect immediately — it is the only account-level permission
            the product has.
          </p>
        </div>
        <div className="pba-list">
          {admins.map((a) => (
            <div key={a.id} className="pba-list-row">
              <div className="pba-list-main">
                <div className="pba-list-name">{a.email}</div>
                <div className="pba-list-sub">
                  {a.clerkUserId ? "Signed in" : "Has not signed in yet"}
                </div>
              </div>
              {a.email === viewerEmail ? (
                <span className="pba-list-sub">you</span>
              ) : (
                <form action={removeAdminAction}>
                  <input type="hidden" name="adminId" value={a.id} />
                  <button type="submit" className="pba-linkbtn pba-linkbtn-danger">
                    Remove
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
        <form action={addAdminAction} className="pba-form">
          <input
            type="email"
            name="email"
            required
            placeholder="teammate@example.com"
            className="pba-input pba-input-grow"
          />
          <button type="submit" className="pba-btn pba-btn-primary">
            Add admin
          </button>
        </form>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   DRAWER (accounts only)
   ──────────────────────────────────────────────────────────────────────── */

export function AccountDrawer({
  account,
  teamSize,
  query,
  recentAccess,
}: {
  account: WorkspaceSummary | null;
  /** Agents attached to this workspace — real, from listAgentEmails. */
  teamSize: number;
  query: AdminQuery;
  /** This workspace's slice of the access log, newest first. */
  recentAccess: ImpersonationSession[];
}) {
  if (!account) {
    return (
      <aside className="pba-drawer">
        <p className="pba-card-sub">
          Pick an account from the table to see its details.
        </p>
      </aside>
    );
  }

  const status = accountStatus(account);
  const closed = account.totalCount - account.openCount;

  return (
    <aside className="pba-drawer">
      <div className="pba-drawer-head">
        <h2 className="pba-drawer-name">{account.name}</h2>
        <form action={selectWorkspaceAction}>
          <input type="hidden" name="workspaceId" value={account.id} />
          <button type="submit" className="pba-linkbtn">
            Open workspace →
          </button>
        </form>
      </div>

      <div className="pba-card">
        <dl className="pba-dl">
          <div>
            <dt className="pba-dt">Inbound address</dt>
            <dd className="pba-dd pba-mono">{account.inboundEmail}</dd>
          </div>
          <div>
            <dt className="pba-dt">Sending address</dt>
            <dd className="pba-dd pba-mono">{account.sendingEmail}</dd>
          </div>
          <div>
            <dt className="pba-dt">Owner</dt>
            <dd className="pba-dd">{account.ownerEmail ?? "—"}</dd>
          </div>
          <div>
            <dt className="pba-dt">Plan</dt>
            <dd className="pba-dd">No plans exist — nothing is billed.</dd>
          </div>
          <div>
            <dt className="pba-dt">Customer since</dt>
            <dd className="pba-dd">{formatDate(account.createdAt)}</dd>
          </div>
          <div>
            <dt className="pba-dt">Status</dt>
            <dd className="pba-dd">
              <StatusPill status={status} />
            </dd>
          </div>
        </dl>
      </div>

      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">All time</h2>
          <p className="pba-card-sub">
            The design asked for &ldquo;this month&rdquo;. Nothing exposes
            per-period totals, so these are lifetime counts rather than a window
            that would be wrong.
          </p>
        </div>
        <div className="pba-tiles">
          <div className="pba-tile">
            <div className="pba-tile-value">{account.totalCount}</div>
            <div className="pba-tile-label">Enquiries</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">{account.openCount}</div>
            <div className="pba-tile-label">Open</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">{closed}</div>
            <div className="pba-tile-label">Closed</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">{teamSize}</div>
            <div className="pba-tile-label">Team members</div>
          </div>
        </div>
      </div>

      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Operator access</h2>
          <p className="pba-card-sub">
            Who from Postbox has been inside this workspace. Impersonation only
            — sign-ins, admin actions and API traffic are still not logged
            anywhere.
          </p>
        </div>
        {recentAccess.length === 0 ? (
          <p className="pba-log-entry">
            No recorded visit to this workspace. Anything before access logging
            shipped left no trace, so this is not proof that nobody ever went in.
          </p>
        ) : (
          <div>
            {recentAccess.map((s) => {
              const state = sessionState(s);
              return (
                <div key={s.id} className="pba-log-entry">
                  <div className="pba-log-who">{s.adminEmail}</div>
                  <div className="pba-log-when">
                    {formatDateTime(s.startedAt)} · {duration(s, state)} ·{" "}
                    {state === "ended"
                      ? s.endedReason
                        ? END_LABEL[s.endedReason]
                        : "ended"
                      : state === "active"
                        ? "in progress"
                        : "never closed"}
                  </div>
                  {s.reason && <div className="pba-log-when">{s.reason}</div>}
                </div>
              );
            })}
          </div>
        )}
        <p className="pba-note">
          <Link href={hrefFor(query, { section: "access" })}>
            Full access log →
          </Link>
        </p>
      </div>

      <div className="pba-drawer-actions">
        {/* The reason is optional — making it mandatory only teaches people to
            type "support". It is recorded exactly as given, or as "none". */}
        <form action={selectWorkspaceAction}>
          <input type="hidden" name="workspaceId" value={account.id} />
          <input
            type="text"
            name="reason"
            maxLength={500}
            autoComplete="off"
            placeholder="Why are you going in? (optional, logged)"
            className="pba-input pba-input-grow"
          />
          <button type="submit" className="pba-btn pba-btn-block">
            Impersonate
          </button>
        </form>
        {account.pending && (
          <form action={resendInviteAction}>
            <input type="hidden" name="workspaceId" value={account.id} />
            <button type="submit" className="pba-btn pba-btn-block">
              Resend invite
            </button>
          </form>
        )}
        <Link
          href={`${hrefFor(query, { account: account.id })}&delete=${account.id}`}
          className="pba-btn pba-btn-danger pba-btn-block"
        >
          Delete workspace…
        </Link>
      </div>
      <p className="pba-note">
        The design&rsquo;s second button was <b>Suspend</b>. An account has no
        suspended state to move it into — the only destructive action that exists
        is permanent deletion, so that is what sits here.
      </p>
    </aside>
  );
}
