import InstallView from "@/components/InstallView";
import { resolveWorkspace } from "@/lib/workspace";
import { APP_URL } from "@/lib/config";

export default async function InstallPage() {
  const { workspace } = await resolveWorkspace();

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
