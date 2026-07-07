import Sidebar from "@/components/Sidebar";
import { resolveWorkspace } from "@/lib/workspace";
import { listTickets } from "@/lib/data";
import { accentVars } from "@/lib/theme";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, agent } = await resolveWorkspace();
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
        userLabel={agent.email}
        counts={counts}
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
