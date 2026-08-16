import { redirect } from "next/navigation";
import InstallView from "@/components/InstallView";
import { resolveViewer } from "@/lib/viewer";
import { APP_URL, EMAIL_FROM_ADDRESS } from "@/lib/config";

export default async function InstallPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  // Prefer the request's own origin at runtime when APP_URL is left default.
  const appUrl = APP_URL;

  // .pbm-page makes a non-mail route behave as a single pane inside the mail
  // shell (which is a flex row since the rebuild).
  return (
    <div className="pbm-page pb-scroll">
      <InstallView
        apiKey={workspace.apiKey}
        inboundEmail={workspace.inboundEmail}
        replyFrom={`"${workspace.name}" <${EMAIL_FROM_ADDRESS}>`}
        workspaceName={workspace.name}
        accent={workspace.accent}
        appUrl={appUrl}
      />
    </div>
  );
}
