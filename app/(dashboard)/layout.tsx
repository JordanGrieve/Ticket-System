import { redirect } from "next/navigation";
import MailNav from "@/components/mail/MailNav";
import { resolveViewer } from "@/lib/viewer";
import { ThemeApplier } from "@/components/ThemeApplier";
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
      <main className="pb-main pbm-main">{children}</main>
    </div>
  );
}
