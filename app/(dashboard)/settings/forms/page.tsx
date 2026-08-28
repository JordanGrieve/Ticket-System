import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveViewer } from "@/lib/viewer";
import { listForms } from "@/lib/forms";
import { countTicketsPerForm } from "./queries";
import {
  createFormAction,
  renameFormAction,
  revokeFormKeyAction,
  regenerateFormKeyAction,
} from "./actions";
import "./forms.css";

export const metadata = { title: "Forms · Settings · Postbox" };

/**
 * Named contact forms.
 *
 * ── WHY THIS SCREEN EXISTS ──
 * The design has always assumed a workspace has several — "Connected forms:
 * Contact · Enquiry · Demo request" — and until now a workspace had one key
 * and every submission arrived undifferentiated. The /settings page said so in
 * as many words: "naming individual forms was never wired up".
 *
 * ── THE WORKSPACE KEY IS SHOWN FIRST, AND IS NOT A FORM ──
 * Every installation in existence posts with it, so it appears at the top as
 * what it is: the original way in, still working, belonging to no named form.
 * Hiding it would make somebody think their live form had disappeared.
 *
 * ── COUNTS ARE HERE BECAUSE THEY ARE THE ONLY HONEST TEST ──
 * A form's key is correct if enquiries are arriving on it and suspect if they
 * are not. "0 enquiries" next to a form installed last month is the single
 * most useful thing this page can say — it is the bakery's six-week silence,
 * visible.
 */
export default async function FormsSettingsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const [forms, counts] = await Promise.all([
    listForms(workspace.id),
    countTicketsPerForm(workspace.id),
  ]);

  return (
    <div className="stg-wrap">
      <header className="stg-head">
        <h1 className="stg-title">Forms</h1>
        <p className="stg-sub">
          Give each form on your site its own key, and every enquiry says which
          one it came through. Useful when the contact page and the wholesale
          page want different answers.
        </p>
      </header>

      {/*
        The workspace key, listed as itself.

        It is not a form and cannot be renamed or revoked here — revoking it
        would take down every installation at once, which is a thing somebody
        should have to go looking for rather than find beside a Revoke button.
      */}
      <section className="pbf-card pbf-card--default">
        <div className="pbf-row">
          <div className="pbf-main">
            <p className="pbf-name">
              Your original form key
              <span className="pbf-badge">always works</span>
            </p>
            <p className="pbf-note">
              What your site posts with today. Enquiries on this key are not
              tied to a named form, which is why some say “—” below.
            </p>
          </div>
          <p className="pbf-count">
            {counts.unattributed}{" "}
            {counts.unattributed === 1 ? "enquiry" : "enquiries"}
          </p>
        </div>
      </section>

      <section className="pbf-new">
        <h2 className="stg-h2">Add a form</h2>
        <form action={createFormAction} className="pbf-newform">
          <label className="pbf-label" htmlFor="pbf-new-name">
            What is it for?
          </label>
          <div className="pbf-newrow">
            <input
              id="pbf-new-name"
              className="pbf-input"
              name="name"
              required
              maxLength={80}
              placeholder="Wholesale enquiries"
            />
            <button className="pbf-btn pbf-btn--primary" type="submit">
              Create
            </button>
          </div>
          <p className="pbf-hint">
            You will get a key to paste into that page. The{" "}
            <Link href="/settings/install">install screen</Link> has the full
            snippet.
          </p>
        </form>
      </section>

      {forms.length > 0 && (
        <section>
          <h2 className="stg-h2">Your forms</h2>
          <ul className="pbf-list">
            {forms.map((f) => {
              const count = counts.byForm.get(f.id) ?? 0;
              return (
                <li className="pbf-card" key={f.id}>
                  <div className="pbf-row">
                    <form action={renameFormAction} className="pbf-main">
                      <input type="hidden" name="formId" value={f.id} />
                      {/*
                        The name IS the input. A separate "edit" mode for a
                        single text field is a state to get stuck in; typing
                        and pressing enter is the whole interaction.
                      */}
                      <input
                        className="pbf-input pbf-input--name"
                        name="name"
                        defaultValue={f.name}
                        maxLength={80}
                        aria-label={`Rename ${f.name}`}
                      />
                    </form>
                    <p className="pbf-count">
                      {count} {count === 1 ? "enquiry" : "enquiries"}
                    </p>
                  </div>

                  {f.key ? (
                    <div className="pbf-keyrow">
                      <code className="pbf-key">{f.key}</code>
                      <form action={revokeFormKeyAction}>
                        <input type="hidden" name="formId" value={f.id} />
                        <button className="pbf-btn" type="submit">
                          Revoke
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="pbf-keyrow">
                      {/*
                        Revoked and never-published are the same state on
                        purpose — one thing to understand, and the way out of
                        both is the same button.
                      */}
                      <p className="pbf-note pbf-note--off">
                        No key. This form accepts nothing until you issue one.
                      </p>
                      <form action={regenerateFormKeyAction}>
                        <input type="hidden" name="formId" value={f.id} />
                        <button className="pbf-btn pbf-btn--primary" type="submit">
                          Issue a key
                        </button>
                      </form>
                    </div>
                  )}

                  {f.key && count === 0 && (
                    /*
                      The most valuable line on the page. A live key with no
                      enquiries is either a form nobody has used yet or one
                      that is quietly broken — which is exactly how Open Door
                      Bakery's contact form failed for six weeks without
                      anybody knowing. Saying it here does not diagnose it, but
                      it does stop the silence being invisible.
                    */
                    <p className="pbf-warn">
                      Nothing has arrived on this key yet. If the form is live
                      on your site, it may not be posting here.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
