import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { DEFAULT_CONFIG } from "@/lib/auto-reply";
import { getAutoReplyConfig } from "@/lib/auto-reply-send";
import AutoReplySettings from "./AutoReplySettings";
import "../../settings.css";

export const metadata = { title: "Auto-reply · Postbox" };

/**
 * /settings — auto-acknowledgement configuration.
 *
 * `.pbm-page` makes a non-mail route render as a single document pane inside
 * the mail shell (same trick as /install and /contacts).
 */
export default async function SettingsPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const stored = await getAutoReplyConfig(workspace.id);

  return (
    <div className="pbm-page pb-scroll">
      <AutoReplySettings
        initialConfig={stored ?? DEFAULT_CONFIG}
        configured={!!stored}
        workspaceName={workspace.name}
      />
    </div>
  );
}
