import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { resolveViewer } from "@/lib/viewer";
import { listTickets } from "@/lib/data";
import { accentVars } from "@/lib/theme";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await resolveViewer();
  // An admin who hasn't picked a client yet goes to the admin overview.
  if (viewer.isAdmin && !viewer.workspace) redirect("/admin");

  const workspace = viewer.workspace!;
  const userLabel = viewer.isAdmin ? viewer.email : viewer.agentEmail;
  const tickets = await listTickets(workspace.id);

  const counts = {
    inbox: tickets.filter((t) => t.status !== "closed").length,
    all: tickets.length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };

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
