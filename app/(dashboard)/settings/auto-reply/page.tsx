import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { DEFAULT_CONFIG } from "@/lib/auto-reply";
import { getAutoReplyConfig } from "@/lib/auto-reply-send";
import AutoReplySettings from "./AutoReplySettings";

export const metadata = { title: "Auto-reply · Settings · Postbox" };

/**
 * /settings/auto-reply — auto-acknowledgement configuration.
 *
 * This used to be the default settings tab at /settings; General took that slot
 * when the theme picker landed, and auto-reply moved down a segment. The pane
 * wrapper and the stylesheet live in the settings layout, shared with the other
 * tabs.
 */
export default async function AutoReplyPage() {
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
