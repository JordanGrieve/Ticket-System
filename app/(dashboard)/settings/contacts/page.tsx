import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { listContactsWithCounts } from "@/lib/data";
import { initials, relativeTime } from "@/lib/tickets";

/**
 * Every person who has ever contacted this workspace — collected since v1,
 * now finally visible. CRM-lite: name, email, first seen, ticket count.
 *
 * Layout lives in the .stc-* classes in app/settings.css, not inline: this
 * page used to paint #fff cards on #efeadf borders, which is a cream card on
 * a dark ground in five of the six themes. Keeping it in the stylesheet also
 * gives it the media queries an inline style cannot carry, and lets
 * loading.tsx borrow the same geometry instead of restating it.
 */
export default async function ContactsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");

  const rows = await listContactsWithCounts(viewer.workspace.id);
  const now = new Date();

  return (
    // The pane wrapper lives in the settings layout, shared with the other tabs.
    <div className="stc-wrap">
      <div className="stc-col">
        <header className="stc-head">
          <h1 className="stc-title">Contacts</h1>
          <p className="stc-sub">
            {rows.length} {rows.length === 1 ? "person" : "people"} have
            contacted {viewer.workspace.name}
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="stc-empty">
            No contacts yet — everyone who submits your form or emails in will
            appear here automatically.
          </p>
        ) : (
          <ul className="stc-list">
            {rows.map((c) => (
              <li className="stc-row" key={c.id}>
                <span className="stc-avatar" aria-hidden>
                  {initials(c.name)}
                </span>
                <span className="stc-person">
                  <span className="stc-name">{c.name}</span>
                  <span className="stc-email">{c.email}</span>
                </span>
                <span className="stc-meta">
                  <span className="stc-count">
                    {c.ticketCount} {c.ticketCount === 1 ? "ticket" : "tickets"}
                  </span>
                  <span className="stc-seen" title="First seen">
                    {relativeTime(c.firstSeen, now)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
