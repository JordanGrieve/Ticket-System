import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { sortTeam, MAX_TEAM_SIZE } from "@/lib/team";
import { initials } from "@/lib/tickets";
import { inviteTeammateAction, revokeTeammateAction } from "./actions";
import { listTeam } from "./queries";

export const metadata = { title: "Team · Settings · Postbox" };

/**
 * Who else can get into this workspace.
 *
 * ── WHY IT LOOKS LIKE A WARNING ──
 * There are no roles in this product. An invite grants total access: read every
 * customer message, reply as the business, change the settings, send campaigns.
 * And it is claimed by EMAIL MATCH, with no token — so a mistyped address does
 * not fail, it hands a stranger the inbox.
 *
 * A screen that presented that as a tidy "+ Add member" would be lying by
 * omission. The consequence is stated next to the field, before the button.
 *
 * Server Component with plain form posts: no client JavaScript, so it works the
 * same way the rest of Settings does and needs no hydration to be usable.
 */
export default async function TeamSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const { error, notice } = await searchParams;
  const team = sortTeam(await listTeam(workspace.id));
  const full = team.length >= MAX_TEAM_SIZE;

  return (
    <div className="stg-wrap">
      <header className="stg-head">
        <h1 className="stg-title">Team</h1>
        <p className="stg-sub">
          Everybody who can sign in to <b>{workspace.name}</b>. They all see the
          same inbox and reply as the business — customers never see individual
          names.
        </p>
      </header>

      {error && (
        <p className="stg-identity-warn" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="stg-notice" role="status">
          {notice}
        </p>
      )}

      <section className="stg-section">
        <h2 className="stg-section-title">
          {team.length} {team.length === 1 ? "person" : "people"}
        </h2>

        <ul className="stc-list">
          {team.map((m) => {
            const isSelf =
              m.email.toLowerCase() === viewer.email.toLowerCase();
            return (
              <li className="stc-row" key={m.id}>
                <span className="stc-avatar" aria-hidden>
                  {initials(m.email)}
                </span>
                <span className="stc-person">
                  <span className="stc-name">
                    {m.email}
                    {isSelf && <span className="stg-you"> — you</span>}
                    {m.role === "owner" && (
                      <span className="stg-owner"> · Owner</span>
                    )}
                  </span>
                  <span className="stc-email">
                    {m.pending
                      ? "Invited — hasn’t signed in yet"
                      : "Has signed in"}
                  </span>
                </span>
                <span className="stc-meta">
                  {/*
                    No button for yourself. Removing your own access is one
                    click from having no way back in, and the recovery path is
                    "email the operator", which is not a feature.

                    No button for the owner either. Everyone here has the same
                    powers — that is said plainly on the invite form — but an
                    invitee being able to delete the person whose business this
                    is was never part of that bargain, and since an invite is
                    claimed by whoever signs in with the address, it is a
                    mis-typed invite away rather than a disgruntled-staff story.

                    checkRevoke refuses both server-side. Hiding the buttons
                    only removes the temptation and the pointless round trip.
                  */}
                  {!isSelf && m.role !== "owner" && team.length > 1 && (
                    <form action={revokeTeammateAction}>
                      <input type="hidden" name="agentId" value={m.id} />
                      <button className="stg-remove" type="submit">
                        Remove
                      </button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="stg-section">
        <h2 className="stg-section-title">Add someone</h2>

        {full ? (
          <p className="stg-section-sub">
            You’ve reached the limit of {MAX_TEAM_SIZE} people. Remove somebody
            before adding another.
          </p>
        ) : (
          <form action={inviteTeammateAction}>
            <label className="stg-field">
              <span className="stg-field-label">Their email address</span>
              <input
                className="stg-input"
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="off"
                placeholder="name@yourbusiness.com"
              />
            </label>

            {/*
              The consequence, stated before the button rather than after the
              mistake. This is the whole reason the screen exists in this shape.
            */}
            <p className="stg-identity-warn" role="note">
              <b>They’ll be able to do everything you can:</b> read every
              message your customers send, reply as {workspace.name}, change
              these settings and send newsletters. There are no limited
              accounts yet.
              <br />
              <br />
              The invite is claimed by <b>whoever signs in with that address</b>
              , so check it carefully — a typo doesn’t bounce, it lets somebody
              else in.
            </p>

            <button className="stg-button" type="submit">
              Send invite
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
