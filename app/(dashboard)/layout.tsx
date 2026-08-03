import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { resolveViewer } from "@/lib/viewer";
import { countTickets } from "@/lib/data";
import { accentVars } from "@/lib/theme";

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
  // Grouped COUNT — the sidebar no longer loads every ticket row.
  const counts = await countTickets(workspace.id);

  return (
    <div
      className="pb-shell"
      style={{
        ...accentVars(workspace.accent),
        background: "var(--app-bg)",
        color: "var(--ink)",
      }}
    >
      {/* Renders its own mobile top bar + scrim; on desktop it is just the
          static 222px column it always was. */}
      <Sidebar
        workspaceName={workspace.name}
        userLabel={userLabel}
        counts={counts}
        isAdmin={viewer.isAdmin}
      />
      <main className="pb-main" style={{ background: "var(--app-bg)" }}>
        {children}
      </main>
    </div>
  );
}
