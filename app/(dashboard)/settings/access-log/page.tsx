import { redirect } from "next/navigation";
import type { ImpersonationEnd, ImpersonationSession } from "@/db/schema";
import {
  listImpersonationSessionsForWorkspace,
  sessionStates,
  type SessionState,
} from "@/lib/impersonation";
import { resolveViewer } from "@/lib/viewer";
import {
  readsForSessions,
  type ImpersonationReadRow,
} from "@/lib/impersonation-reads";
import { exportsForWorkspace } from "@/lib/admin-audit";
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
 * ── IT ALSO NAMES THE CONVERSATIONS NOW ──
 * This page was taken off Settings on 28 August and put back on the 30th, and
 * the two days changed what it is able to say. When it came off it could only
 * report that somebody entered; impersonation_reads now records which tickets
 * were opened, so it reports that too, linked so the client can go and look.
 *
 * That record is BEST EFFORT — the write is allowed to fail rather than break
 * a page an operator is working in — so an empty list is rendered as "none
 * recorded" and never as "none". The page says so in its own words further
 * down, because a client relying on this as a complete inventory would be
 * relying on something it is not.
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

  /*
    Which of their conversations were opened during each of those visits.

    One query for the whole page rather than one per visit — neon-http gives
    every statement its own HTTP request, so a per-row lookup here would be up
    to LIMIT round trips on a settings page.

    TENANCY. This is keyed by session id, and every session id came from
    listImpersonationSessionsForWorkspace above, which is already filtered to
    this workspace. So the reads cannot reach outside it: there is no id in
    this route for a client to change, and nothing here widens what the query
    above already narrowed.
  */
  const reads = await readsForSessions(sessions.map((s) => s.id));

  /*
    Bulk copies of this workspace taken by Postbox. Same tenancy argument as
    everything else here: the id comes from resolveViewer, never from the URL.
  */
  const dataExports = await exportsForWorkspace(workspace.id);

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
                <Visit
                  key={s.id}
                  session={s}
                  state={states[i]}
                  reads={reads.get(s.id) ?? []}
                />
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

      {/*
        Copies of the whole workspace, kept apart from the visit list.

        Not folded into a visit, even though one always happens during one. An
        export is a different kind of event — the data left our servers in a
        file rather than being looked at on a screen — and burying it as a line
        inside a visit would understate it. It is the most significant thing on
        this page when it has happened at all, so it gets its own heading and
        sits above the caveats rather than below them.

        Absent entirely when there are none: a permanent empty "no copies
        taken" section trains the reader to skip the space it occupies, which
        is the one place on this page that must catch the eye.
      */}
      {dataExports.length > 0 && (
        <section className="stg-section">
          <h2 className="stg-section-title">Copies taken of all your data</h2>
          <p className="stg-section-sub">
            Someone at Postbox downloaded everything this workspace holds &mdash;
            every conversation, every message, and every contact &mdash; as a
            single file. This is not a conversation being opened; it is all of
            them leaving at once.
          </p>
          <ol className="stg-al-list">
            {dataExports.map((e) => (
              <li key={e.id} className="stg-al-visit">
                <div className="stg-al-visit-head">
                  <div className="stg-al-who">
                    <span className="stg-al-who-email">{e.actorEmail}</span>
                  </div>
                  <span className="stg-al-pill" data-state="copy">
                    Full copy taken
                  </span>
                </div>
                <dl className="stg-al-facts">
                  <div className="stg-al-fact stg-al-fact-wide">
                    <dt className="stg-al-key">When</dt>
                    <dd className="stg-al-val">{formatDateTime(e.createdAt)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
          <p className="stg-al-note">
            Ask us what any of these were for. A copy is normally taken to
            investigate something you reported, and it should match a
            conversation you have had with us &mdash; if one does not, that is
            worth raising.
          </p>
        </section>
      )}

      <section className="stg-section">
        <h2 className="stg-section-title">What this log does and does not say</h2>
        <p className="stg-al-note">
          It records <b>entry into your workspace</b>, and, since 30 August
          2026, <b>which conversations were opened</b> while someone was in.
          Visits before that date have no record of what was read, and this
          page does not pretend otherwise — they show no conversations because
          none were logged, not because none were opened.
        </p>
        <p className="stg-al-note">
          The list of conversations is a <b>floor, not an inventory</b>. Writing
          that record is allowed to fail without stopping the page an operator
          is looking at, because you losing your thread mid-problem would be a
          worse failure than a gap in our audit trail. So a visit showing no
          conversations means none were <i>recorded</i>, which is not the same
          as none being read. We would rather say that plainly than have you
          rely on this as a complete list.
        </p>
        <p className="stg-al-note">
          Still not covered, so you are not left assuming otherwise: your own
          team&rsquo;s sign-ins and what they read, anything reached other than
          by opening a conversation &mdash; a contact&rsquo;s details, your
          subscriber list, a campaign report &mdash; and anything done directly
          against the database by us.
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
 * These are the same `endedReason` values the operator console shows, said
 * plainly. "switched" in particular is worth spelling out: it means the
 * operator moved on to another workspace, which is how we know they left this
 * one — not something to hide behind a one-word label.
 *
 * Exhaustive by type: this is a Record over the whole union, so adding a
 * reason in db/schema.ts fails the build here until the client has been given
 * words for it. That is deliberate. A reason the operator console can name and
 * this page cannot would be a gap in exactly the direction that hides access.
 */
const END_LABEL: Record<ImpersonationEnd, string> = {
  stopped: "Ended — the operator left",
  signed_out: "Ended — the operator signed out of Postbox",
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
  reads,
}: {
  session: ImpersonationSession;
  state: SessionState;
  /** Conversations opened during this visit. Empty means none RECORDED. */
  reads: ImpersonationReadRow[];
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

        <div className="stg-al-fact stg-al-fact-wide">
          <dt className="stg-al-key">Conversations opened</dt>
          <dd className="stg-al-val">
            {reads.length === 0 ? (
              /*
                NOT "none". The write that records a read is best effort by
                design — see lib/impersonation-reads.ts — and visits before 30
                August 2026 have nothing recorded at all. Printing "none" here
                would be the page claiming a fact it does not have, on the one
                screen whose whole purpose is not doing that.
              */
              <span className="stg-al-unset">None recorded</span>
            ) : (
              <ul className="stg-al-reads">
                {reads.map((r) => (
                  <li key={r.ticketId}>
                    {/*
                      Linked, because these are THEIR conversations and the
                      number on its own is a lookup we would be making them do
                      by hand. A conversation since deleted will 404 — the log
                      deliberately outlives the record it names, so that the
                      deletion cannot erase the evidence that it was read.
                    */}
                    <a
                      className="stg-link"
                      href={`/tickets/${r.ticketId}`}
                    >
                      Conversation #{r.ticketId}
                    </a>
                    {r.count > 1 && (
                      <span className="stg-al-read-n">
                        {" "}
                        opened {r.count} times
                      </span>
                    )}
                    <span className="stg-al-sub">
                      last opened {formatDateTime(r.lastAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}
