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
      style={{
        ...accentVars(workspace.accent),
        display: "flex",
        height: "100vh",
        width: "100%",
        background: "var(--app-bg)",
        color: "var(--ink)",
        overflow: "hidden",
      }}
    >
      <Sidebar
        workspaceName={workspace.name}
        userLabel={userLabel}
        counts={counts}
        isAdmin={viewer.isAdmin}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--app-bg)",
        }}
      >
        {children}
      </main>
    </div>
  );
}
