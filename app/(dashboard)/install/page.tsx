import { redirect } from "next/navigation";
import InstallView from "@/components/InstallView";
import { resolveViewer } from "@/lib/viewer";
import { APP_URL } from "@/lib/config";

export default async function InstallPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  // Prefer the request's own origin at runtime when APP_URL is left default.
  const appUrl = APP_URL;

  return (
    <InstallView
      apiKey={workspace.apiKey}
      inboundEmail={workspace.inboundEmail}
      sendingEmail={workspace.sendingEmail}
      workspaceName={workspace.name}
      accent={workspace.accent}
      appUrl={appUrl}
    />
  );
}
