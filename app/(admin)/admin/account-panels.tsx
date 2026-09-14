import Link from "next/link";
import type { WorkspaceSummary } from "@/lib/data";
import type { ImpersonationSessionRow as ImpersonationSession } from "@/lib/impersonation";
import type { ImpersonationReadRow } from "@/lib/impersonation-reads";
import { sessionState, type SessionState } from "@/lib/impersonation-view";
import { trialEndsAt } from "@/lib/trial";
import { billingState, describePlan } from "./billing-rollup";
import type { WorkspaceUsage } from "./queries";
import {
  deleteClientAction,
  resendInviteAction,
  selectWorkspaceAction,
} from "./actions";
import {
  accountStatus,
  formatDate,
  formatDateTime,
  formatDuration,
  hrefFor,
  END_LABEL,
  StatusPill,
  type AdminQuery,
} from "./ui";

/**
 * The two panels that hang off a selected account: the drawer and the
 * type-the-name delete confirmation.
 *
 * ── WHY THEY ARE NOT IN sections.tsx ──
 *
 * Because AccountsBrowser is a Client Component and imports them, and
 * sections.tsx opens with `@/lib/ingestion-log` and `@/lib/feedback-log` —
 * both `server-only`. Importing one component out of that file pulls the whole
 * module into the browser bundle, and the build stops on `server-only` with an
 * import trace four levels deep.
 *
 * Typecheck cannot see any of that: every signature is identical either side
 * of the boundary. Only `next build` walks the import graph, which is exactly
 * why AGENTS.md says to run it after a change that moves code across the
 * server/client line — this one was caught by the build and nothing else.
 *
 * Everything imported here is pure or a Server Action. Server Actions are
 * fine in a client bundle: they are a reference, not the code.
 */

export function DeletePanel({ target }: { target: WorkspaceSummary }) {
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
        {/* The most consequential field in the console, and it was named only
            by a placeholder that vanishes as soon as you start typing the
            workspace name into it. */}
        <input
          type="text"
          name="confirmName"
          required
          autoComplete="off"
          aria-label={`Type the workspace name "${target.name}" to confirm deletion`}
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

export function AccountDrawer({
  account,
  teamSize,
  query,
  recentAccess,
  reads,
  usage,
}: {
  account: WorkspaceSummary | null;
  /** Agents attached to this workspace — real, from listAgentEmails. */
  teamSize: number;
  query: AdminQuery;
  /** This workspace's slice of the access log, newest first. */
  recentAccess: ImpersonationSession[];
  /** Records opened during those visits, keyed by session id. */
  reads: Map<number, ImpersonationReadRow[]>;
  /** This workspace's confirmed subscribers and trial-window tickets. */
  usage: WorkspaceUsage | null;
}) {
  if (!account) {
    return (
      <aside className="pba-drawer">
        <p className="pba-card-sub">Pick an account from the table to see its details.</p>
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
      </div>

      <div className="pba-card">
        <div className="pba-card-head">
          <h2 className="pba-card-title">Operator access</h2>
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
              const opened = reads.get(s.id)?.length ?? 0;
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
                  <div className="pba-log-when">
                    {opened === 0
                      ? "no records recorded as opened"
                      : `${opened} ${opened === 1 ? "record" : "records"} opened`}
                  </div>
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
            aria-label="Reason for entering this workspace (optional, recorded in the access log)"
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
    </aside>
  );
}