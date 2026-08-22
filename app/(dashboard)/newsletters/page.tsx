import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { listCampaigns } from "@/lib/campaign-send";
import { APP_URL } from "@/lib/config";
import { RECIPIENTS_PER_SWEEP } from "@/lib/campaign-cron";
import { workspaceLists } from "./queries";
import Composer, { type CampaignRowDTO } from "./Composer";
import "../../newsletter.css";

export const metadata = { title: "Newsletters · Postbox" };

/**
 * /newsletters — the campaign composer.
 *
 * Phase 1 of docs/NEWSLETTER-BUILDER-PLAN.md: ONE page, not the four-step block
 * wizard in the design. Name, subject, preheader, a `<select>` over the two
 * template keys that actually exist, one plain-text body with merge-tag insert
 * buttons, a live preview through the real renderer, and one list picker with a
 * real recipient count. Blocks, segments, fonts and the dark-mode preview are
 * all deliberately absent — section 4 of that document says why for each.
 *
 * A server component whose only job is to hand the client island three things
 * it must not read for itself:
 *
 *  - `appUrl`, which comes from lib/config. That module carries `server-only`
 *    and reads non-NEXT_PUBLIC_ env vars; importing it from a client component
 *    (directly or transitively) took production down once already. It is passed
 *    as a plain string, exactly as lib/newsletter.ts's header requires.
 *  - the workspace name, which the branded shell renders.
 *  - the viewer's email, shown against the disabled "send a test" control so
 *    the explanation names the address that WOULD have been used.
 *  - `RECIPIENTS_PER_SWEEP`, from lib/campaign-cron.ts. That module imports
 *    node:crypto for the cron authorisation check, so the client island cannot
 *    import it; passing the number keeps the composer's "how long will this
 *    take" figures derived from the real batch size rather than a copy of it
 *    that would drift.
 *
 * lib/newsletter.ts is pure and is imported by the client island directly —
 * that is the whole point of it being pure, and it is what makes the preview
 * the same bytes the send path would produce.
 */
export default async function NewslettersPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const [campaigns, lists] = await Promise.all([
    listCampaigns(workspace.id),
    workspaceLists(workspace.id),
  ]);

  // Dates cross the server/client boundary as ISO strings and are formatted in
  // the browser, for the same reason lib/serialize.ts does it: formatting on
  // the server renders UTC for everybody.
  const rows: CampaignRowDTO[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    subject: c.subject,
    status: c.status,
    listId: c.listId,
    listName: c.listName,
    recipientCount: c.recipientCount,
    updatedAtIso: c.updatedAt.toISOString(),
    sentAtIso: c.sentAt ? c.sentAt.toISOString() : null,
  }));

  // `.pbm-page pb-scroll` is the shell's "one document-shaped pane" wrapper,
  // the same one app/(dashboard)/settings/layout.tsx uses. The dashboard shell
  // is height-constrained with overflow hidden, so a route that does not opt
  // into this scroll container simply clips.
  return (
    <div className="pbm-page pb-scroll">
      <Composer
        initialCampaigns={rows}
        lists={lists}
        workspaceName={workspace.name}
        legalName={workspace.legalName}
        postalAddress={workspace.postalAddress}
        appUrl={APP_URL}
        viewerEmail={viewer.email}
        recipientsPerSweep={RECIPIENTS_PER_SWEEP}
      />
    </div>
  );
}
