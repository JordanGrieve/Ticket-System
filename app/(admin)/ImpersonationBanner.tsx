import { currentImpersonation } from "@/lib/viewer";
import { stopImpersonatingAction } from "./admin/actions";
import { formatDateTime } from "./admin/ui";
import "./impersonation-banner.css";

/**
 * Shown for the whole time a Postbox operator is acting inside a client
 * workspace. Renders nothing for a normal tenant.
 *
 * ── IT USED TO BE A FULL-WIDTH BAR, AND IT WAS TOO BIG ──
 * Every fact about the session was on screen at once: the workspace, the
 * operator's address, the start time, the reason, the access-log id. On a
 * phone that wrapped to five lines and took roughly half the viewport — Jordan
 * sent a screenshot where the banner was taller than the first two tickets
 * combined. Worse, `.pbi-meta` was set to wrap on small screens while the
 * shell only bought back a fixed 62px, so the extra lines sat ON TOP of the
 * inbox they were meant to sit above.
 *
 * It is now a pill in the top-right corner. The detail did not go away — it
 * moved inside a <details> that opens on press — because the access-log id and
 * the start time are the things an operator quotes when something goes wrong,
 * and deleting them to save space would be trading an audit trail for a layout.
 *
 * ── WHAT MUST NOT CHANGE, WHATEVER THE SHAPE ──
 * Still no dismiss, and still no collapsed-to-nothing state. The point is that
 * an operator cannot forget whose customers' names and email addresses are on
 * the screen, so the workspace NAME stays visible in the collapsed pill rather
 * than only inside the disclosure. A banner you can hide is a banner that gets
 * hidden on the first long session.
 *
 * "Stop" also stays outside the disclosure. It is the escape hatch, and an
 * escape hatch you have to open a menu to find is one click too far when the
 * reason you are reaching for it is that you are somewhere you should not be.
 *
 * ── THE UNRECORDED STATE ──
 * When the operator is inside a workspace but no open audit row covers it (a
 * selection made before this feature shipped, or a row closed from another
 * device), the pill turns red and says so IN THE COLLAPSED STATE — it does not
 * hide that behind the disclosure, because it is a fault rather than a detail.
 * It does not invent a start time either.
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
      <details className="pbi-disclosure">
        <summary className="pbi-summary">
          <span className="pbi-stripe" aria-hidden />
          {/*
            The workspace name is the one fact that stays visible collapsed.
            Everything else is recoverable from the access log; "whose data am
            I looking at" is the question the pill exists to keep answering.
          */}
          <span className="pbi-name">{workspace.name}</span>
          {!session && <span className="pbi-alarm">not recorded</span>}
          <span className="pbi-chev" aria-hidden />
        </summary>

        <div className="pbi-panel">
          <p className="pbi-panel-lead">
            You are inside <b>{workspace.name}</b> as a Postbox operator. This
            is a client&rsquo;s live customer data.
          </p>
          <p className="pbi-meta">
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
                {operatorEmail} · <b>this visit is NOT being recorded</b> —
                there is no open access-log entry for it. Stop, then re-enter
                from the admin console so the access is logged.
              </>
            )}
          </p>
        </div>
      </details>

      <form action={stopImpersonatingAction}>
        <button type="submit" className="pbi-stop">
          Stop
        </button>
      </form>
    </div>
  );
}
