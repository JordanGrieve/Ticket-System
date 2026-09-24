import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import {
  DEFAULT_WELCOME,
  getWelcomeEmail,
  welcomeConfigFrom,
} from "@/lib/welcome-store";
import WelcomeEmailForm from "../../settings/WelcomeEmailForm";
import "../../../settings.css";

export const metadata = { title: "Welcome newsletter" };

/**
 * /newsletters/welcome — the one newsletter that sends itself.
 *
 * ── WHY IT IS HERE AND NOT IN SETTINGS ──
 * It was in Settings → General, under Newsletter branding, on the reasoning
 * that the settings strip already overflows at nine tabs. That reasoning was
 * about where a TAB should go and it answered the wrong question: a client
 * looking for the emails their newsletter sends looks at Newsletters. Jordan,
 * 14 Sep 2026, standing on that page: "I don't see the newsletter on AMORIA's
 * page." Something nobody can find is something nobody edits, and this one
 * sends to real customers whether or not it has been read.
 *
 * ── WHY IT IS NOT THE COMPOSER ──
 * It shares the composer's pieces — the same fields, the same validators, the
 * same renderer driving the preview — and deliberately not the composer
 * itself. That component is a campaign's whole lifecycle: drafts, an audience,
 * a schedule, a send, an abort, a sweep count. A welcome has none of those. It
 * goes to one person at the moment they subscribe. Threading a second kind of
 * thing through all of that would put scheduling controls one state
 * bug away from something with nothing to schedule.
 *
 * The form is a client island; every value it needs to run the real renderer
 * is read here and passed down as plain data. Same rule as the composer's
 * page: nothing that would drag lib/config into the browser bundle.
 */
export default async function WelcomeNewsletterPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const welcome = await getWelcomeEmail(workspace.id);

  return (
    <div className="pbm-page pb-scroll">
      <div className="stg-wrap">
        <header className="stg-head">
          {/* Back to the rail it was opened from. The composer is a client
              island with its own state, so this is a navigation, not a tab. */}
          <Link className="stg-link" href="/newsletters">
            ← Newsletters
          </Link>
          <h1 className="stg-title">Welcome newsletter</h1>
          <p className="stg-sub">
            Sent automatically the moment somebody subscribes — the only email
            here that goes out without you pressing send. It carries your name,
            your colours and the unsubscribe link every newsletter has.
          </p>
        </header>

        <section className="stg-section">
          <WelcomeEmailForm
            initial={welcome ? welcomeConfigFrom(welcome) : DEFAULT_WELCOME}
            hasPostalAddress={(workspace.postalAddress ?? "").trim().length > 0}
            workspaceName={workspace.name}
            legalName={workspace.legalName}
            postalAddress={workspace.postalAddress}
            brandAccentHex={workspace.brandAccentHex}
            brandSignOff={workspace.brandSignOff}
            viewerEmail={viewer.email}
          />
        </section>
      </div>
    </div>
  );
}
