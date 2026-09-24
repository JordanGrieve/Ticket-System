import { redirect } from "next/navigation";
import InstallView from "@/components/InstallView";
import { resolveViewer } from "@/lib/viewer";
import { APP_URL, EMAIL_FROM_ADDRESS } from "@/lib/config";
import { HONEYPOT_FIELDS, hostedSignupUrl } from "@/lib/subscribe";

export const metadata = { title: "Install · Settings" };

export default async function InstallPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const appUrl = APP_URL;

  // hostedSignupUrl() is the contract for the signup page; the POST endpoint
  // has no helper of its own, so it is built here beside it.
  //
  // The key in both URLs is `workspace.apiKey` — the viewer's own workspace,
  // resolved from the session by resolveViewer(). It is a public ingestion key
  // by design (it ends up in the client's page source), which is why rendering
  // it is fine; what would not be fine is taking it from the URL.
  const subscribeEndpoint = `${appUrl.replace(/\/$/, "")}/api/subscribe/${encodeURIComponent(workspace.apiKey)}`;

  // The pane wrapper lives in the settings layout, shared with the other tabs.
  return (
    <InstallView
      apiKey={workspace.apiKey}
      inboundEmail={workspace.inboundEmail}
      replyFrom={`"${workspace.name}" <${EMAIL_FROM_ADDRESS}>`}
      workspaceName={workspace.name}
      appUrl={appUrl}
      subscribeEndpoint={subscribeEndpoint}
      hostedSignupUrl={hostedSignupUrl(appUrl, workspace.apiKey)}
      honeypotFields={HONEYPOT_FIELDS}
      requireSignupConfirmation={workspace.requireSignupConfirmation}
    />
  );
}
