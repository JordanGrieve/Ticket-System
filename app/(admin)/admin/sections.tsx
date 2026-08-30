import Link from "next/link";
import type { Admin, ImpersonationEnd, ImpersonationSession } from "@/db/schema";
import type { WorkspaceSummary } from "@/lib/data";
import type { IngestionFailureRow } from "@/lib/ingestion-log";
import { describeDropReason, type FeedbackDropRow } from "@/lib/feedback-log";
import {
  describeAdminAction,
  isDestructiveAdminAction,
  type AdminActionRow,
} from "@/lib/admin-audit";
import {
  sessionState,
  sessionStates,
  type SessionState,
} from "@/lib/impersonation";
import { formatPrice, TRIAL_LIMITS } from "@/lib/pricing";
import { entitlement, trialEndsAt } from "@/lib/trial";
import { billingState, describePlan, planRollup } from "./billing-rollup";
import type { CampaignTotals, TransactionalTotals, WorkspaceUsage } from "./queries";
import "../access-log.css";
import "./console.css";
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
   ENVIRONMENT GATES
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The environment answers, read by the caller and passed in.
 *
 * Same arrangement as lib/campaign-health.ts, and for the same reason: these
 * sections have to say things like "that zero means nothing, because the
 * webhook that would move it off zero is not configured", and a component
 * that reaches into `process.env` itself cannot be reasoned about from its
 * props. page.tsx reads them; everything here just renders what it is told.
 *
 * Each one is the difference between a number that means something and a
 * number that means nothing, which is why they are on screen rather than in a
 * README.
 */
export type ConsoleGates = {
  /** STRIPE_SECRET_KEY is set, so checkout can run at all. */
  stripeConfigured: boolean;
  /** Every plan in lib/pricing.ts has a Stripe price id behind it. */
  allPricesConfigured: boolean;
  /** RESEND_API_KEY is set, so transactional mail actually leaves. */
  transactionalSending: boolean;
  /**
   * A Resend webhook signing secret is set. Without it that endpoint refuses
   * every request, so no ticket message can ever advance past the status the
   * send path wrote — "delivered: 0" would then be a statement about our
   * configuration, not about anybody's mail.
   */
  transactionalFeedback: boolean;
  /** CAMPAIGN_DELIVERY_MODE is exactly "ses". False means nothing transmits. */
  campaignDeliveryLive: boolean;
  /** SES_SNS_TOPIC_ARN is set, so bounce and complaint feedback is accepted. */
  campaignFeedback: boolean;
};

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

  // One clock for the whole table. Read per row, two workspaces either side of
  // a period boundary could be judged against different instants.
  const now = new Date();

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
          <div className="pba-grid pba-grid-accounts">
            <div className="pba-thead">
              <div className="pba-row pba-row-accounts pba-th">
                <div>Company</div>
                <div>Owner</div>
                <div>Plan</div>
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
                    <div className="pba-td">{describePlan(w, now)}</div>
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
        The design asked for <b>Plan</b>, <b>Subscribers</b> and <b>MRR</b>{" "}
        columns, and for a long time none of the three had anything behind them.
        Two now do. <b>Plan</b> is above, from the workspace&rsquo;s own billing
        state &mdash; every workspace is on exactly one, starting at Trial, and
        only the Stripe webhook ever moves it. <b>Subscribers</b> is counted per
        account in the drawer and in Billing, where there is room to say which
        subscribers are being counted: confirmed ones only, because somebody who
        filled in a form and never clicked the link is not stored at all.{" "}
        <b>MRR</b> is deliberately not a column here &mdash; a per-row money
        figure invites adding it up, and the sum has caveats that do not fit in
        a cell. It is on <b>Overview</b>, with them.
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

export function OverviewSection({
  accounts,
  gates,
}: {
  accounts: WorkspaceSummary[];
  gates: ConsoleGates;
}) {
  const newest = [...accounts]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 6);

  const now = new Date();
  // WorkspaceSummary is a superset of BillingRow — it IS the workspace row —
  // so this needs no mapping. The rollup only ever reads the three billing
  // columns it declares.
  const rollup = planRollup(accounts, now);

  return (
    <>
      <KpiGrid accounts={accounts} />
      <div className="pba-cols">
        <div className="pba-col-main">
          <div className="pba-card">
            <div className="pba-card-head">
              <h2 className="pba-card-title">Subscriptions by plan</h2>
              <p className="pba-card-sub">
                The design called this &ldquo;Revenue by plan&rdquo;. It is
                renamed because it is not revenue: it is the list price of what
                each account is currently entitled to. Postbox stores no
                invoices &mdash; those live in Stripe &mdash; so nothing here
                knows about a discount, a proration, a refund or tax.
              </p>
            </div>
            <div className="pba-table">
              <div className="pba-scroll">
                <div className="pba-grid">
                  <div className="pba-thead">
                    <div className="pba-row pba-row-plans pba-th">
                      <div>Plan</div>
                      <div>Price</div>
                      <div>Workspaces</div>
                      <div>Of those, paying</div>
                      <div>Monthly</div>
                    </div>
                  </div>
                  <div className="pba-tbody">
                    {rollup.rows.map((r) => (
                      <div key={r.plan} className="pba-row pba-row-plans">
                        <div className="pba-cell-main">{r.label}</div>
                        <div className="pba-td">
                          {r.price === null ? "—" : `${formatPrice(r.price)}/mo`}
                        </div>
                        <div className="pba-num">{r.workspaces}</div>
                        <div className="pba-td">
                          {r.paying}
                          {(r.comped > 0 || r.lapsed > 0) && (
                            <div className="pba-cell-sub">
                              {[
                                r.comped > 0 ? `${r.comped} comped` : null,
                                r.lapsed > 0 ? `${r.lapsed} lapsed` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                        </div>
                        <div className="pba-num">
                          {r.mrr === 0 ? "—" : formatPrice(r.mrr)}
                        </div>
                      </div>
                    ))}
                    <div className="pba-row pba-row-plans pba-row-plans-total">
                      <div>Total</div>
                      <div />
                      <div className="pba-num">{accounts.length}</div>
                      <div className="pba-num">{rollup.paying}</div>
                      <div className="pba-num">{formatPrice(rollup.mrr)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p className="pba-note">
              Only a workspace with a Stripe subscription whose paid period has
              not ended contributes to the total. A <b>comped</b> account is on a
              paid plan with no subscription behind it &mdash; the pilot client,
              anything predating billing, or a deliberate grant &mdash; and is
              worth £0 by decision, not by accident. A <b>lapsed</b> one paid
              once and its period has run out; it keeps its access until
              somebody downgrades it, so it is counted as an account and not as
              money.
              {rollup.trials === accounts.length && accounts.length > 0 && (
                <>
                  {" "}
                  Every workspace is currently on trial, so this total is £0 and
                  that is the true figure rather than a missing one.
                </>
              )}
            </p>
            {!gates.stripeConfigured && (
              <p className="pba-note">
                <b>No Stripe key is set in this deployment.</b> Nobody can reach
                checkout from here, so any paid plan above was granted some other
                way. Treat the total as a statement about entitlements, not
                about a card ever having been charged.
              </p>
            )}
            {gates.stripeConfigured && !gates.allPricesConfigured && (
              <p className="pba-note">
                Stripe is connected but at least one plan has no price id set,
                so that tier cannot be bought. A tier nobody can buy will sit at
                zero here forever and look like a tier nobody wants.
              </p>
            )}
            <p className="pba-note">
              The prices come from <code>lib/pricing.ts</code>, where they are
              recorded as a proposal Jordan has not signed off. They are real
              enough to charge with once a Stripe price exists for them, and not
              yet a promise anybody has made.
            </p>
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
  signed_out: "Signed out",
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

export function AccessSection({
  sessions,
  actions,
}: {
  sessions: ImpersonationSession[];
  /** Platform-level operator actions. See lib/admin-audit.ts. */
  actions: AdminActionRow[];
}) {
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
      {/*
        A second table, not a second page. "Who went into a client" and "who
        deleted a client" are the same question asked by the same person on the
        same bad afternoon, and splitting them across two screens means one of
        them gets missed.
      */}
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Operator actions on the platform</h2>
          <p className="pba-card-sub">
            Creating and deleting workspaces, and granting or revoking
            super-admin. Recorded <b>before</b> each action runs, so a deletion
            that fails halfway still leaves a trace &mdash; and kept with no
            link to the workspace it names, because a cascade would delete the
            record of its own deletion.
          </p>
        </div>
        {actions.length === 0 ? (
          <p className="pba-card-sub" style={{ padding: "0 18px 18px" }}>
            Nothing recorded. No workspace has been created or deleted, and no
            super-admin granted or revoked, since this started being kept.
          </p>
        ) : (
          <div className="pba-table">
            <div className="pba-scroll">
              <div className="pba-row pba-row-head">
                <span>Action</span>
                <span>Operator</span>
                <span>Target</span>
                <span>When</span>
                <span>Detail</span>
              </div>
              {actions.map((a) => (
                <div
                  className="pba-row pba-row-diag"
                  key={a.id}
                  data-destructive={
                    isDestructiveAdminAction(a.action) || undefined
                  }
                >
                  <span>{describeAdminAction(a.action)}</span>
                  <span>{a.actorEmail}</span>
                  <span>{a.targetLabel ?? "—"}</span>
                  <span>{formatDateTime(a.createdAt)}</span>
                  <span className="pba-mono">{a.detail ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="pba-note">
        Together these record <b>entry into a workspace</b> and{" "}
        <b>changes to the platform</b> — not individual reads. Neither can tell
        you which tickets were opened or which customer&rsquo;s details were on
        screen; no per-record access is captured anywhere in Postbox. Sign-ins,
        API-key traffic and anything done directly against the database are
        still uncovered.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   BILLING
   ──────────────────────────────────────────────────────────────────────── */

export function BillingSection({
  accounts,
  usage,
  gates,
}: {
  accounts: WorkspaceSummary[];
  /** Confirmed subscribers and trial-window tickets, per workspace id. */
  usage: Map<number, WorkspaceUsage>;
  gates: ConsoleGates;
}) {
  const now = new Date();

  return (
    <div className="pba-stack">
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Where every account stands</h2>
          <p className="pba-card-sub">
            The billing state of each workspace, as Postbox understands it. Two
            different facts sit side by side here on purpose:{" "}
            <b>Plan</b> is what the workspace is entitled to, and{" "}
            <b>Stripe says</b> is the last thing the payment provider told us.
            They are allowed to disagree &mdash; a card retrying for four days
            reads <code>past_due</code> against a period that is still paid for,
            and locking somebody out of their customer mail that afternoon would
            be taking something they bought.
          </p>
        </div>
        <div className="pba-table">
          <div className="pba-scroll">
            <div className="pba-grid pba-grid-billing">
              <div className="pba-thead">
                <div className="pba-row pba-row-billing pba-th">
                  <div>Workspace</div>
                  <div>Plan</div>
                  <div>Stripe says</div>
                  <div>Paid / trial through</div>
                  <div>Subscribers</div>
                  <div>Enquiries</div>
                </div>
              </div>
              <div className="pba-tbody">
                {accounts.length === 0 && (
                  <div className="pba-row">
                    <div className="pba-td">No workspaces yet.</div>
                  </div>
                )}
                {accounts.map((w) => {
                  const u = usage.get(w.id);
                  const state = billingState(w, now);
                  // Real usage, so a trial that has hit its ceiling reads as
                  // blocked rather than as "9 days left". The rules are
                  // lib/trial.ts's, not restated here.
                  const e = entitlement(
                    w,
                    {
                      tickets: u?.ticketsSinceTrialStart ?? 0,
                      subscribers: u?.subscribers ?? 0,
                    },
                    now,
                  );
                  return (
                    <div key={w.id} className="pba-row pba-row-billing">
                      <div>
                        <div className="pba-cell-main">{w.name}</div>
                        <div className="pba-cell-sub">
                          {w.ownerEmail ?? w.inboundEmail}
                        </div>
                      </div>
                      <div>
                        <div className="pba-td">{describePlan(w, now)}</div>
                        {e.blockedReason && (
                          <div className="pba-cell-sub">
                            newsletters blocked
                          </div>
                        )}
                      </div>
                      <div className="pba-td">
                        {w.subscriptionStatus ?? (
                          <span className="pba-withheld">never asked</span>
                        )}
                      </div>
                      <div className="pba-td">
                        {state === "trial"
                          ? formatDate(trialEndsAt(w.trialStartedAt))
                          : w.currentPeriodEnd
                            ? formatDate(w.currentPeriodEnd)
                            : "—"}
                      </div>
                      <div className="pba-num">{u?.subscribers ?? 0}</div>
                      <div className="pba-num">{w.totalCount}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <p className="pba-note">
          <b>Never asked</b> in the Stripe column means this workspace has never
          reached checkout, which is the expected state for a trial and for a
          comped account. It is not an error and it is not a missing read.{" "}
          <b>Subscribers</b> counts confirmed opt-ins only. A trial is measured
          against {TRIAL_LIMITS.tickets} enquiries and{" "}
          {TRIAL_LIMITS.subscribers} subscribers as well as against its dates,
          and whichever runs out first ends it &mdash; so a trial can be
          blocked with days still on the clock.
        </p>
        {!gates.stripeConfigured && (
          <p className="pba-note">
            <b>Stripe is not configured in this deployment.</b> Checkout and the
            billing portal both refuse, and no webhook can arrive, so nothing in
            the Stripe column will ever change here.
          </p>
        )}
      </div>

      <NotBuilt
        title="Postbox keeps no invoices of its own"
        text="Checkout, the billing portal and the subscription webhook all exist, and the table above is the state they produce. What does not exist is any record of the money: no invoice, receipt, tax line, refund or dunning attempt is stored in this database. All of it lives in the Stripe dashboard, and this console does not call the Stripe API to fetch it — an operator answering “what did they actually pay in July?” has to open Stripe. That is a deliberate stopping point rather than an oversight: mirroring invoices means storing tax and payment records with the retention and accuracy duties that come with them, and a half-mirrored ledger that disagrees with Stripe is worse than no ledger at all."
        missing={[
          "Invoices & receipts",
          "Tax / VAT records",
          "Refunds & credit notes",
          "Dunning attempts",
        ]}
      />
    </div>
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
  drops,
  transactional,
  campaignTotals,
  gates,
}: {
  accounts: WorkspaceSummary[];
  /** Aggregated rejected ingestion attempts. See lib/ingestion-log.ts. */
  rejections: IngestionFailureRow[];
  /** Feedback that could not be attributed. See lib/feedback-log.ts. */
  drops: FeedbackDropRow[];
  /** Outbound ticket mail by delivery status. See ./queries.ts. */
  transactional: TransactionalTotals;
  /** Newsletter sends by recipient and campaign status. See ./queries.ts. */
  campaignTotals: CampaignTotals;
  gates: ConsoleGates;
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
                <div className="pba-row pba-row-diag" key={`${r.reason}:${r.keyPrefix}`}>
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

      {/*
        Second, and for the same reason as the card above it: this is a real
        measurement of a real silence. The SES webhook drops feedback it cannot
        attribute — correctly, because suppressing globally would let one
        tenant's bounce silence an address for every other tenant — and until
        this card existed the drop went only to console.warn.

        Which meant a systematic attribution failure looked exactly like clean
        sending. Empty is the expected state, so the empty text has to say what
        it means rather than reading as "not built".
      */}
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Bounces we couldn&rsquo;t attribute</h2>
          <p className="pba-card-sub">
            Feedback from SES that matched no campaign recipient, so nothing
            was suppressed. A low background rate is normal &mdash; ticket mail
            shares the configuration set and has no recipient row. A jump means
            sends have stopped recording their provider ids, and no bounce is
            suppressing anybody.
          </p>
        </div>
        {drops.length === 0 ? (
          <p className="pba-card-sub" style={{ padding: "0 18px 18px" }}>
            Nothing dropped. Every bounce and complaint that has arrived was
            matched to a recipient and acted on.
          </p>
        ) : (
          <div className="pba-table">
            <div className="pba-scroll">
              <div className="pba-row pba-row-head">
                <span>Reason</span>
                <span>Event</span>
                <span>Count</span>
                <span>Last seen</span>
                <span>Example message</span>
              </div>
              {drops.map((d) => (
                <div className="pba-row pba-row-diag" key={`${d.reason}:${d.eventType}`}>
                  {/* The explanation is the title, so an operator gets the
                      "so what" on hover without a second screen. */}
                  <span title={describeDropReason(d.reason)}>
                    {d.reason === "no_message_id"
                      ? "No message id"
                      : "Unmatched message id"}
                  </span>
                  <span>{d.eventType}</span>
                  <span>{d.count}</span>
                  <span>{formatDate(d.lastSeenAt)}</span>
                  <span className="pba-mono">
                    {d.lastMessageId ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/*
        Third: ticket replies. This card could not have existed before 23
        August 2026 — the provider's id for a send was thrown away, so a bounce
        notification had nothing to match against and every transactional
        failure was unattributable by construction. It is measured now, so it
        is shown, and the gate lines below say exactly how far to trust it.
      */}
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Ticket replies</h2>
          <p className="pba-card-sub">
            Every outbound message on a ticket &mdash; a teammate&rsquo;s reply
            or an out-of-hours acknowledgement &mdash; by what we last heard
            about it. Counts, not rates: see the note under them for why there
            is no percentage here.
          </p>
        </div>
        <div className="pba-tiles">
          <div className="pba-tile">
            <div className="pba-tile-value">{transactional.total}</div>
            <div className="pba-tile-label">Sent, all time</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">
              {transactional.byStatus.delivered}
            </div>
            <div className="pba-tile-label">Confirmed delivered</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">
              {transactional.byStatus.bounced}
            </div>
            <div className="pba-tile-label">Bounced</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">{transactional.byStatus.failed}</div>
            <div className="pba-tile-label">Never left</div>
          </div>
        </div>
        <p className="pba-note">
          <b>Never left</b> is a send the provider refused or that we never
          attempted &mdash; including every reply written while email sending
          was unconfigured, which is written as a failure rather than as a
          success nobody checked. Of the {transactional.total} outbound
          messages, {transactional.byStatus.queued + transactional.unrecorded}{" "}
          carry no outcome: {transactional.unrecorded} predate the outcome being
          recorded at all.
        </p>
        {!gates.transactionalFeedback && (
          <p className="pba-note">
            <b>No delivery webhook is configured for transactional mail.</b> The
            endpoint fails closed without its signing secret, so nothing can
            advance a message past what the send path wrote.{" "}
            <b>Confirmed delivered</b> and <b>Bounced</b> above can therefore
            only be zero, and their zero says nothing about whether anybody
            received their reply.
          </p>
        )}
        {!gates.transactionalSending && (
          <p className="pba-note">
            <b>Transactional sending is not configured in this deployment.</b>{" "}
            Replies are stored and shown to the client as sent from their side,
            and no email leaves the building.
          </p>
        )}
        <p className="pba-note">
          No delivery <i>rate</i> is shown, and that is deliberate. A percentage
          needs a denominator everybody agrees on, and here it would be computed
          over messages whose status was never confirmed by anyone &mdash;
          &ldquo;98% delivered&rdquo; would mostly be measuring our own
          optimism at send time.
        </p>
      </div>

      {/*
        Fourth: newsletters. Deliberately separate from the card above, because
        they are a different provider with a different reputation and a
        different set of gates — merging them would let a healthy transactional
        record hide a newsletter pipeline that has never transmitted anything.
      */}
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Newsletter sends</h2>
          <p className="pba-card-sub">
            Per-recipient rows across every campaign on the platform.{" "}
            {campaignTotals.campaigns.sent} campaign
            {campaignTotals.campaigns.sent === 1 ? " has" : "s have"} been
            marked finished, {campaignTotals.campaigns.sending} are sending and{" "}
            {campaignTotals.campaigns.scheduled} are waiting on the clock.
          </p>
        </div>
        <div className="pba-tiles">
          <div className="pba-tile">
            <div className="pba-tile-value">
              {campaignTotals.recipients.queued}
            </div>
            <div className="pba-tile-label">Queued</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">
              {campaignTotals.recipients.sent +
                campaignTotals.recipients.delivered}
            </div>
            <div className="pba-tile-label">Handed to the provider</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">
              {campaignTotals.recipients.bounced}
            </div>
            <div className="pba-tile-label">Bounced</div>
          </div>
          <div className="pba-tile">
            <div className="pba-tile-value">
              {campaignTotals.recipients.complained}
            </div>
            <div className="pba-tile-label">Complained</div>
          </div>
        </div>
        {gates.campaignDeliveryLive ? (
          <p className="pba-note">
            Newsletter delivery is live, so these rows describe real mail.{" "}
            {campaignTotals.recipients.failed} send
            {campaignTotals.recipients.failed === 1 ? "" : "s"} failed outright.
          </p>
        ) : (
          <p className="pba-note">
            <b>Nothing here has reached anybody.</b> Campaign delivery is in
            log-only mode: the sweep runs, claims each recipient row and marks
            it sent, and the deliverer writes a log line instead of calling a
            provider. Every figure above is therefore a count of the pipeline
            working, not of mail arriving, and it stays that way until SES
            production access comes through and the mode is switched
            deliberately.
          </p>
        )}
        {!gates.campaignFeedback && (
          <p className="pba-note">
            The SES feedback endpoint has no topic configured, so bounces and
            complaints cannot be accepted. Those two tiles can only read zero.
          </p>
        )}
      </div>

      <NotBuilt
        title="No account has a sending domain of its own"
        text="Both send paths are measured now — the two cards above are counted from real rows — but every workspace still sends from the platform's own verified subdomain, so one reputation carries every tenant's mail and one client's bounce rate is everybody's problem. sending_domains is the table that would fix that: per-workspace SPF, DKIM and DMARC state, checked against DNS. Not one row has ever been written to it and nothing reads it. It is unbuilt rather than abandoned, and it is not blocked on code: verifying a client's domain against a sandboxed SES account would prove nothing, so it waits on production access with everything else. Until then this pane cannot answer per-account deliverability questions at all — only platform-wide ones."
        missing={[
          "Per-account sending domains",
          "SPF / DKIM / DMARC checks",
          "Per-account reputation",
          "Open & click tracking",
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
        text="Still true, and unchanged by everything else that has been built. The designed ticket cards need a priority, an assignee and a ticket that belongs to Postbox rather than to a client. None of those exist: tickets are tenant-owned, nothing anywhere has a priority or an assignee column, and there is no channel through which a client can raise anything with us. A client with a problem emails somebody, or does not."
        missing={["Operator tickets", "Priority", "Assignment", "SLA / response times"]}
      />

      {/*
        Not a placeholder — a real conflict between two things that are both
        shipped. The pricing page sells it; nothing behind it exists. Worth
        saying on the operator's screen rather than in a task nobody reads.
      */}
      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">We are selling this</h2>
          <p className="pba-card-sub">
            The Business plan on the public pricing page lists{" "}
            <b>&ldquo;Priority support from us&rdquo;</b> among its features.
            There is no queue, no priority and no channel, so nothing
            distinguishes a Business customer&rsquo;s request from anybody
            else&rsquo;s &mdash; it arrives, if it arrives at all, in somebody&rsquo;s
            personal inbox. That is a promise the product cannot currently keep,
            and the gap widens with every Business subscription sold.
          </p>
        </div>
      </div>

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
  usage,
}: {
  account: WorkspaceSummary | null;
  /** Agents attached to this workspace — real, from listAgentEmails. */
  teamSize: number;
  query: AdminQuery;
  /** This workspace's slice of the access log, newest first. */
  recentAccess: ImpersonationSession[];
  /** This workspace's confirmed subscribers and trial-window tickets. */
  usage: WorkspaceUsage | null;
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
  const now = new Date();
  const state = billingState(account, now);

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
            <dd className="pba-dd">{describePlan(account, now)}</dd>
          </div>
          <div>
            <dt className="pba-dt">
              {state === "trial" ? "Trial ends" : "Paid through"}
            </dt>
            <dd className="pba-dd">
              {state === "trial" ? (
                formatDate(trialEndsAt(account.trialStartedAt))
              ) : account.currentPeriodEnd ? (
                formatDate(account.currentPeriodEnd)
              ) : (
                // A comped account has no period and never will. Saying so
                // beats an em-dash that reads as a failed lookup.
                <span className="pba-withheld">no period — not charged</span>
              )}
            </dd>
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
          <div className="pba-tile">
            <div className="pba-tile-value">{usage?.subscribers ?? 0}</div>
            <div className="pba-tile-label">Subscribers</div>
          </div>
        </div>
        <p className="pba-note">
          Subscribers are confirmed opt-ins only. Somebody who filled in a
          signup form and never clicked the confirmation link is not stored at
          all, so this can never be inflated by a stranger typing addresses into
          a client&rsquo;s public form.
        </p>
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
