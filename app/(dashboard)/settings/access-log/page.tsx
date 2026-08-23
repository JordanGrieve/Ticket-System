import { redirect } from "next/navigation";
import type { ImpersonationEnd, ImpersonationSession } from "@/db/schema";
import {
  listImpersonationSessionsForWorkspace,
  sessionStates,
  type SessionState,
} from "@/lib/impersonation";
import { resolveViewer } from "@/lib/viewer";
// The operator console's formatters, imported rather than reimplemented. This
// screen and app/(admin)/admin/sections.tsx are two views of ONE table, and the
// client must be able to quote a row back at us and have it match what we see.
// A second copy of "how a timestamp is written" is how those two drift into
// disagreeing about the same visit.
import { formatDateTime, formatDuration } from "@/app/(admin)/admin/ui";

export const metadata = { title: "Access log · Settings · Postbox" };

/**
 * Settings → Access log. The client's own copy of impersonation_sessions.
 *
 * ── WHY THIS PAGE EXISTS ──
 * Postbox operators can enter a client workspace to look into a problem, and
 * every entry writes a row to impersonation_sessions. Until now that record was
 * visible only in our own admin console — the people whose customers' data was
 * read could not see that it had been read. The client is the data controller
 * and we are their processor; the record of processor access is theirs, not
 * ours to keep to ourselves.
 *
 * ── IT IS THE SAME DATA, NOT A FRIENDLIER VERSION OF IT ──
 * Same rows, same clock, same classification (`sessionStates`), same
 * formatters. Two things are deliberately left out and nothing is added:
 *
 *   • workspace — every row here is theirs by construction, so a column that
 *     is the same value on every line is noise.
 *   • adminClerkUserId — an internal auth-provider id. It identifies a person
 *     in a system the client has no access to and cannot act on; it is there
 *     for our own forensics, and printing it here would be volume, not
 *     transparency.
 *
 * The operator's EMAIL is shown. See the note above OperatorLine.
 *
 * ── HONESTY ──
 * `endedAt` null means we never observed the session end. This page does not
 * turn that into an end time and does not call it "still active": an open row
 * is either genuinely live (a request in the last 15 minutes) or abandoned, and
 * abandoned is rendered as "never observed to end" with the last request we
 * actually saw. A null `reason` is rendered as "no reason given", never
 * softened into a plausible one.
 */

/** Newest first. Deliberately larger than the operator console's page. */
const LIMIT = 200;

export default async function AccessLogPage() {
  const viewer = await resolveViewer();
  // TENANCY. The workspace comes from the session, via resolveViewer, and from
  // nowhere else — there is no id in this route and no search param that could
  // carry one. A client asking for another client's log has nothing to type.
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const sessions = await listImpersonationSessionsForWorkspace(
    workspace.id,
    LIMIT,
  );

  // One clock for the whole list, so no two rows are classified against
  // different instants and land either side of the abandoned threshold.
  const states = sessionStates(sessions);
  const live = states.filter((s) => s === "active").length;
  const unclosed = states.filter((s) => s === "abandoned").length;

  return (
    <div className="stg-wrap">
      <header className="stg-head">
        <h1 className="stg-title">Access log</h1>
        <p className="stg-sub">
          Someone at Postbox can open <b>{workspace.name}</b> to look into a
          problem. While they are in, they see what your team sees: your inbox,
          your contacts, your customers&rsquo; messages. Every time that happens
          we record it, and this page is that record.
        </p>
      </header>

      {sessions.length === 0 ? (
        <section className="stg-section">
          <div className="stg-al-none">
            <p className="stg-al-none-lead">
              No one from Postbox has entered this workspace.
            </p>
            <p className="stg-al-none-body">
              Not &ldquo;nothing to show&rdquo; — there is no recorded visit to{" "}
              <b>{workspace.name}</b> at all. One caveat, because it is ours and
              not yours: visits made before this log was switched on left no
              row behind, so this cannot speak for the time before it existed.
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="stg-section">
            <div className="stg-al-tiles">
              <div className="stg-al-tile">
                <div className="stg-al-tile-value">{sessions.length}</div>
                <div className="stg-al-tile-label">
                  {sessions.length === 1 ? "Recorded visit" : "Recorded visits"}
                </div>
              </div>
              <div className="stg-al-tile">
                <div className="stg-al-tile-value">{live}</div>
                <div className="stg-al-tile-label">Happening now</div>
              </div>
              <div className="stg-al-tile">
                <div className="stg-al-tile-value">{unclosed}</div>
                <div className="stg-al-tile-label">Never observed to end</div>
              </div>
            </div>
          </section>

          <section className="stg-section">
            <h2 className="stg-section-title">Every recorded visit</h2>
            <p className="stg-section-sub">Most recent first.</p>
            <ol className="stg-al-list">
              {sessions.map((s, i) => (
                <Visit key={s.id} session={s} state={states[i]} />
              ))}
            </ol>
            {sessions.length === LIMIT && (
              <p className="stg-al-note">
                This page shows the {LIMIT} most recent visits. There are older
                ones — ask us and we will send the rest.
              </p>
            )}
          </section>
        </>
      )}

      <section className="stg-section">
        <h2 className="stg-section-title">What this log does and does not say</h2>
        <p className="stg-al-note">
          It records <b>entry into your workspace</b>, not what was read once
          inside. It cannot tell you which conversations were opened or whose
          details were on screen — Postbox does not log access to individual
          records anywhere. It also does not cover your own team&rsquo;s
          sign-ins, or anything done directly against the database by us.
        </p>
        <p className="stg-al-note">
          A visit is only timed exactly when it was closed properly. An operator
          who simply shuts the tab is never seen to leave, so those visits are
          timed from the start to the last request we actually saw and labelled{" "}
          <b>never observed to end</b>. The gap between that last request and
          the moment they really stopped looking is not something we can
          measure, so it is not guessed at here. After fifteen minutes of
          silence the visit stops working as a way in, and the operator has to
          re-enter — which writes a new row.
        </p>
        <p className="stg-al-note">
          Being straight about what this is: it is an audit trail we keep about
          ourselves, in our own database. Nothing in Postbox deletes a row from
          it, including our own admin console, and we do not present it as more
          than that. If a visit here does not line up with something you asked
          us for, quote us the date and time and ask.
        </p>
      </section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

/**
 * How an ended visit ended, in the client's terms rather than ours.
 *
 * These are the same four `endedReason` values the operator console shows, said
 * plainly. "switched" in particular is worth spelling out: it means the
 * operator moved on to another workspace, which is how we know they left this
 * one — not something to hide behind a one-word label.
 */
const END_LABEL: Record<ImpersonationEnd, string> = {
  stopped: "Ended — the operator left",
  switched: "Ended — the operator moved to another workspace",
  workspace_deleted: "Ended — this workspace was deleted",
  admin_removed: "Ended — their operator access was withdrawn",
};

const STATE_LABEL: Record<Exclude<SessionState, "ended">, string> = {
  active: "Happening now",
  abandoned: "Never observed to end",
};

function stateLabel(session: ImpersonationSession, state: SessionState): string {
  if (state !== "ended") return STATE_LABEL[state];
  return session.endedReason ? END_LABEL[session.endedReason] : "Ended";
}

/**
 * WHO. The judgement call on this screen, so it is written down here.
 *
 * The full operator email is shown. The argument against is real — this is a
 * named member of staff, exposed to every client — but it loses on three
 * counts. First, "someone at Postbox read your customers' messages" is not an
 * answer to the question this page exists to answer; a client who wants to
 * challenge one visit, or notice that the same person has been in five times
 * this month, needs to be able to tell one operator from another. Second, this
 * is a work identity acting in a work capacity, recorded because we chose to
 * record it, and every operator knows entry is logged. Third, masking it would
 * be theatre on the one screen whose entire purpose is not doing that: a
 * redaction here teaches the reader to wonder what else on the page has been
 * tidied up. If an operator should not be identifiable to a client, the answer
 * is that they should not be entering that client's workspace.
 *
 * `adminId` being null is shown too, because it is a fact about our end that
 * changes what the client can do about the visit — the account that made it no
 * longer has operator access, so there is nobody left to ask directly.
 */
function OperatorLine({ session }: { session: ImpersonationSession }) {
  return (
    <div className="stg-al-who">
      <span className="stg-al-who-email">{session.adminEmail}</span>
      {session.adminId === null && (
        <span className="stg-al-who-note">
          this account no longer has operator access
        </span>
      )}
    </div>
  );
}

function Visit({
  session,
  state,
}: {
  session: ImpersonationSession;
  state: SessionState;
}) {
  // The observed end, or null. Narrowed here rather than asserted below: an
  // "ended" row with no endedAt would be a contradiction, and if one ever
  // exists this renders it as never-observed-to-end rather than crashing or
  // inventing a time.
  const endedAt = state === "ended" ? session.endedAt : null;

  return (
    <li className="stg-al-visit">
      <div className="stg-al-visit-head">
        <OperatorLine session={session} />
        <span className="stg-al-pill" data-state={state}>
          {stateLabel(session, state)}
        </span>
      </div>

      <dl className="stg-al-facts">
        <div className="stg-al-fact">
          <dt className="stg-al-key">Entered</dt>
          <dd className="stg-al-val">{formatDateTime(session.startedAt)}</dd>
        </div>

        <div className="stg-al-fact">
          <dt className="stg-al-key">In for</dt>
          <dd className="stg-al-val">
            {endedAt !== null ? (
              <>
                {formatDuration(session.startedAt, endedAt)}
                <span className="stg-al-sub">
                  left at {formatDateTime(endedAt)}
                </span>
              </>
            ) : (
              <>
                {/* NOT an end time. This is start → last request we saw, and it
                    is labelled as a floor because the operator may have sat on
                    an open page long after it. */}
                at least{" "}
                {formatDuration(session.startedAt, session.lastSeenAt)}
                <span className="stg-al-sub">
                  {state === "active"
                    ? `still in as of ${formatDateTime(session.lastSeenAt)}`
                    : `last seen ${formatDateTime(session.lastSeenAt)}; never seen to leave`}
                </span>
              </>
            )}
          </dd>
        </div>

        <div className="stg-al-fact stg-al-fact-wide">
          <dt className="stg-al-key">Reason given</dt>
          <dd className="stg-al-val">
            {session.reason ?? (
              // Not "—". They gave none, and that is a thing worth being able
              // to see at a glance across a column of visits.
              <span className="stg-al-unset">None given</span>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}
