import { redirect } from "next/navigation";
import MailNav from "@/components/mail/MailNav";
import { resolveViewer } from "@/lib/viewer";
import { ThemeApplier } from "@/components/ThemeApplier";
import ImpersonationBanner from "@/app/(admin)/ImpersonationBanner";
import TrialBanner from "@/components/TrialBanner";
import { mailCounts } from "./queries";
import "../mail.css";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await resolveViewer();
  // Admins without a selected client → overview; uninvited → no-access.
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");

  const workspace = viewer.workspace;
  const userLabel = viewer.isAdmin ? viewer.email : viewer.agentEmail;
  // One grouped COUNT for all four folders.
  const counts = await mailCounts(workspace.id);

  return (
    <>
      {/* Renders null for tenants. Must be a SIBLING immediately before the
          shell: its CSS uses a `~` selector to buy back its own height from
          .pb-shell, which is height:100dvh with overflow hidden. */}
      <ImpersonationBanner />
      <div className="pb-shell pbm">
        {/* The `accent` column stores a theme key since the pivot. */}
        <ThemeApplier theme={workspace.accent} />
        {/* Renders its own mobile top bar + scrim; on desktop it is the static
            262px navigation column. */}
        <MailNav
          workspaceName={workspace.name}
          userLabel={userLabel}
          counts={counts}
          isAdmin={viewer.isAdmin}
        />
        <main className="pb-main pbm-main">
          {/* Inside <main>, not beside the shell — see the note in
              TrialBanner.tsx. Two `~ .pb-shell` height rules do not add up,
              so an operator inside a trialling client would get one banner
              covering the top of the inbox. Renders null in the common case. */}
          <TrialBanner workspaceId={workspace.id} />
          {children}
        </main>
      </div>
    </>
  );
}
