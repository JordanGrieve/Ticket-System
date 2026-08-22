import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { listAgentEmails } from "@/lib/data";
import { getAutoReplyConfig } from "@/lib/auto-reply-send";
import { EMAIL_FROM_ADDRESS } from "@/lib/config";
import ThemePicker from "./ThemePicker";
import SenderIdentityForm from "./SenderIdentityForm";

export const metadata = { title: "General · Settings · Postbox" };

/**
 * /settings — General, and the default settings tab.
 *
 * A server component on purpose: the inbound address, the reply-from address
 * (which comes from lib/config) and the notification recipients are all read
 * here and handed down as plain strings. ThemePicker is the only client island
 * on the page, and it takes a single string prop — nothing that would drag
 * lib/config into the browser bundle.
 *
 * Honesty rule for this screen: the design shows a fuller workspace than we
 * ship. Rows that have no implementation behind them are rendered with an
 * explicit "Not built" chip rather than plausible-looking sample values. A
 * settings screen that lies about what is switched on is worse than one that
 * admits a gap.
 */
export default async function GeneralSettingsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const [autoReply, notifyEmails] = await Promise.all([
    getAutoReplyConfig(workspace.id),
    listAgentEmails(workspace.id),
  ]);

  return (
    <div className="stg-wrap">
      <header className="stg-head">
        <h1 className="stg-title">General</h1>
        <p className="stg-sub">
          Workspace preferences for <b>{workspace.name}</b>. Everything here
          applies to everyone who signs in to this workspace.
        </p>
      </header>

      {/* ── Appearance ─────────────────────────────────────────── */}
      <section className="stg-section">
        <h2 className="stg-section-title">Appearance</h2>
        <ThemePicker value={workspace.accent} />
      </section>

      {/* ── Sender identity ────────────────────────────────────── */}
      <section className="stg-section">
        <h2 className="stg-section-title">Sender identity</h2>
        <SenderIdentityForm
          legalName={workspace.legalName}
          postalAddress={workspace.postalAddress}
          workspaceName={workspace.name}
        />
      </section>

      {/* ── Inbox ──────────────────────────────────────────────── */}
      <section className="stg-section">
        <h2 className="stg-section-title">Inbox</h2>
        <dl className="stg-rows">
          <Row label="Auto-reply">
            <span className="stg-row-value">
              <span
                className="stg-dot"
                data-on={autoReply?.enabled ? "true" : "false"}
                aria-hidden="true"
              />
              {autoReply?.enabled ? "On" : autoReply ? "Off" : "Not set up"}
            </span>
            <Link className="stg-row-link" href="/settings/auto-reply">
              Edit
            </Link>
          </Row>

          <Row label="Notification email">
            {notifyEmails.length === 0 ? (
              <span className="stg-row-value stg-row-value--muted">
                No one on this workspace yet
              </span>
            ) : (
              <span className="stg-row-value stg-row-mono">
                {notifyEmails.join(", ")}
              </span>
            )}
          </Row>

          <Row label="Inbound address">
            <span className="stg-row-value stg-row-mono">
              {workspace.inboundEmail}
            </span>
            <Link className="stg-row-link" href="/settings/install">
              How to forward
            </Link>
          </Row>

          <Row label="Replies send from">
            <span className="stg-row-value stg-row-mono">
              {`"${workspace.name}" <${EMAIL_FROM_ADDRESS}>`}
            </span>
          </Row>

          <Row label="Connected forms">
            <NotBuilt>
              Every submission arrives on one shared endpoint; naming individual
              forms was never wired up
            </NotBuilt>
          </Row>

          <Row label="Sending domain">
            <NotBuilt>
              Per-client domains were dropped — replies go out from one verified
              domain for everyone
            </NotBuilt>
          </Row>
        </dl>
      </section>

      {/* ── Integrations ───────────────────────────────────────── */}
      <section className="stg-section">
        <h2 className="stg-section-title">Integrations</h2>
        <p className="stg-section-sub">
          Where enquiries come from and where they go next.
        </p>
        <ul className="stg-int-grid">
          <li className="stg-int">
            <span className="stg-int-mark" aria-hidden="true">
              WF
            </span>
            <span className="stg-int-body">
              <span className="stg-int-head">
                <span className="stg-int-name">Website contact form</span>
                <span className="stg-state" data-on="true">
                  Live
                </span>
              </span>
              <span className="stg-int-note">
                Your ingestion endpoint accepts submissions from any site
              </span>
            </span>
            <Link className="stg-int-btn" href="/settings/install">
              Set up
            </Link>
          </li>

          <li className="stg-int" data-unbuilt="true">
            <span className="stg-int-mark" aria-hidden="true">
              SL
            </span>
            <span className="stg-int-body">
              <span className="stg-int-head">
                <span className="stg-int-name">Slack</span>
                <span className="stg-state" data-on="false">
                  Not built
                </span>
              </span>
              <span className="stg-int-note">
                Posting new enquiries to a channel is designed, not implemented
              </span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}

/** One label/value line in a settings list. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stg-row">
      <dt className="stg-row-label">{label}</dt>
      <dd className="stg-row-body">{children}</dd>
    </div>
  );
}

/**
 * A row the design shows but the product does not have. Says so in as many
 * words — no greyed-out fake value that reads as "configured, just dim".
 */
function NotBuilt({ children }: { children: React.ReactNode }) {
  return (
    <span className="stg-row-value stg-row-value--muted">
      <span className="stg-state" data-on="false">
        Not built
      </span>
      <span className="stg-unbuilt-note">{children}</span>
    </span>
  );
}
