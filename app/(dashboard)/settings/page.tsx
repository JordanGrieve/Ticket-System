import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { DEFAULT_CONFIG } from "@/lib/auto-reply";
import { getAutoReplyConfig } from "@/lib/auto-reply-send";
import AutoReplySettings from "./AutoReplySettings";

export const metadata = { title: "Auto-reply · Settings · Postbox" };

/**
 * /settings — auto-acknowledgement configuration, and the default settings tab.
 *
 * The pane wrapper and the stylesheet live in the settings layout, which is
 * shared with the Contacts and Install tabs.
 */
export default async function SettingsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const stored = await getAutoReplyConfig(workspace.id);

  return (
    <AutoReplySettings
      initialConfig={stored ?? DEFAULT_CONFIG}
      configured={!!stored}
      workspaceName={workspace.name}
    />
  );
}
