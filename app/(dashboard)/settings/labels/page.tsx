import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { listLabelsWithCounts } from "@/lib/labels";
import LabelManager from "@/components/mail/LabelManager";

export const metadata = { title: "Labels · Settings · Postbox" };

/**
 * Labels, as a settings screen.
 *
 * ── WHY IT EXISTS ──
 * The nav used to carry a permanent "No labels yet" note purely so the Manage
 * button had somewhere to live, which meant every workspace that has never used
 * labels saw two lines about them forever. Hiding that block needed labels to
 * be reachable from somewhere else first — this is that somewhere, and only
 * once it shipped could the nav block become conditional.
 *
 * ── IT IS THE SAME COMPONENT AS THE NAV MODAL ──
 * `LabelManager` in inline mode. Not a second implementation: a second one
 * would mean two sets of validation rules, two confirm-before-delete patterns
 * and two live regions to keep in step, and they would drift the first time
 * only one of them was fixed. The only real difference between the two
 * placements is the chrome, so only the chrome is conditional.
 *
 * The counts are read here on the server and passed down; the component talks
 * to /api/labels for writes, which already enforce workspace scoping.
 */
export default async function LabelSettingsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");

  const labels = await listLabelsWithCounts(viewer.workspace.id);

  return (
    <div className="stg-wrap">
      <header className="stg-head">
        <h1 className="stg-title">Labels</h1>
        <p className="stg-sub">
          Tags you can put on a conversation to group it. Everyone in{" "}
          <b>{viewer.workspace.name}</b> shares the same set, and customers
          never see them.
        </p>
      </header>

      <section className="stg-section">
        <LabelManager labels={labels} inline />
      </section>
    </div>
  );
}
