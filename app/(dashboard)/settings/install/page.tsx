import { redirect } from "next/navigation";
import InstallView from "@/components/InstallView";
import { resolveViewer } from "@/lib/viewer";
import { APP_URL, EMAIL_FROM_ADDRESS } from "@/lib/config";
import { HONEYPOT_FIELDS, hostedSignupUrl } from "@/lib/subscribe";

export default async function InstallPage() {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  // Prefer the request's own origin at runtime when APP_URL is left default.
  const appUrl = APP_URL;

  // The newsletter URLs and the honeypot field names are resolved HERE, not in
  // InstallView, because lib/subscribe.ts imports node:crypto and InstallView
  // is a Client Component — importing it there would ship node:crypto to the
  // browser. hostedSignupUrl() is the contract; the POST endpoint has no helper
  // of its own, so it is built beside it rather than in the client.
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
    />
  );
}
