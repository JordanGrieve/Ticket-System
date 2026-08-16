import { currentImpersonation } from "@/lib/viewer";
import { stopImpersonatingAction } from "./admin/actions";
import { formatDateTime } from "./admin/ui";
import "./impersonation-banner.css";

/**
 * Shown for the whole time a Postbox operator is acting inside a client
 * workspace. Renders nothing for a normal tenant.
 *
 * ── Where this belongs ──
 * It has to sit in app/(dashboard)/layout.tsx, immediately before the
 * <div className="pb-shell pbm">, so the CSS sibling rule can push the shell
 * down. That file is owned elsewhere; see the note in the handover.
 *
 * ── Why there is no dismiss ──
 * There is no close button and no collapsed state. The point is that an
 * operator cannot forget whose customers' names and email addresses are on the
 * screen, and a banner you can hide is a banner that gets hidden on the first
 * long session. The only way to make it go away is to actually stop.
 *
 * ── The unrecorded state ──
 * When the operator is inside a workspace but no open audit row covers it
 * (a selection made before this feature shipped, or a row closed from another
 * device), the banner turns red and says so. It does not quietly render the
 * normal version, and it does not invent a start time — the honest statement is
 * that this visit is not in the log.
 */
export default async function ImpersonationBanner() {
  const context = await currentImpersonation();
  if (!context) return null;

  const { workspace, operatorEmail, session } = context;

  return (
    <div
      className="pbi-banner"
      data-unlogged={session ? "false" : "true"}
      role="status"
      aria-live="polite"
    >
      <span className="pbi-stripe" aria-hidden />
      <span className="pbi-text">
        <span className="pbi-title">
          You are inside <span className="pbi-name">{workspace.name}</span> as a
          Postbox operator — this is a client&rsquo;s live customer data.
        </span>
        <span className="pbi-meta">
          {session ? (
            <>
              {operatorEmail} · started {formatDateTime(session.startedAt)} ·{" "}
              {session.reason
                ? `reason: ${session.reason}`
                : "no reason was given"}{" "}
              · access #{session.id} is recorded in the access log
            </>
          ) : (
            <>
              {operatorEmail} · <b>this visit is NOT being recorded</b> — there
              is no open access-log entry for it. Stop, then re-enter from the
              admin console so the access is logged.
            </>
          )}
        </span>
      </span>
      <form action={stopImpersonatingAction}>
        <button type="submit" className="pbi-stop">
          Stop impersonating
        </button>
      </form>
    </div>
  );
}
