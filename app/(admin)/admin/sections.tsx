import Link from "next/link";
import type { Admin } from "@/db/schema";
import type { WorkspaceSummary } from "@/lib/data";
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
  formatDate,
  hrefFor,
  KpiGrid,
  NotBuilt,
  StatusPill,
  type AdminQuery,
  type Filter,
} from "./ui";

/* ────────────────────────────────────────────────────────────────────────
   ACCOUNTS
   ──────────────────────────────────────────────────────────────────────── */

const TABS: { key: Filter; label: string }[] = [
  { key: "all", label: "All accounts" },
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
  const countFor = (f: Filter) =>
    f === "all" ? accounts.length : accounts.filter((w) => accountStatus(w) === f).length;

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
        <b>MRR</b> columns. None of the three exist: there is no billing, no
        subscription record and no newsletter audience anywhere in the schema.
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

export function DeliverabilitySection({
  accounts,
}: {
  accounts: WorkspaceSummary[];
}) {
  return (
    <div className="pba-stack">
      <NotBuilt
        title="Nothing about delivery is measured"
        text="Replies go out through one shared provider and no delivery events are stored — not a bounce, not a complaint, not a single send. The four headline numbers this pane was designed around cannot be computed from anything in the database."
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
}: {
  account: WorkspaceSummary | null;
  /** Agents attached to this workspace — real, from listAgentEmails. */
  teamSize: number;
  query: AdminQuery;
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
          <h2 className="pba-card-title">Recent activity</h2>
        </div>
        <NotBuilt
          small
          title="Nothing is logged"
          text="No audit trail is written — not sign-ins, not admin actions, not impersonation. There is no activity to list."
        />
      </div>

      <div className="pba-drawer-actions">
        <form action={selectWorkspaceAction}>
          <input type="hidden" name="workspaceId" value={account.id} />
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
