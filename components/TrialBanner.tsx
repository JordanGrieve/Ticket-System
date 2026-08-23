import Link from "next/link";
import { getWorkspaceEntitlement } from "@/lib/billing-query";
import { trialNotice } from "@/lib/trial";
import TrialBannerDismiss from "./TrialBannerDismiss";
import "./trial-banner.css";

/**
 * The trial countdown, and the "sending is paused" notice.
 *
 * ── WHY IT LIVES INSIDE <main>, NOT BESIDE THE SHELL ──
 * The obvious place was next to ImpersonationBanner, which sits immediately
 * before .pb-shell and buys back its own height with a `~` sibling rule. That
 * does not compose: two such rules do not add up, the later one simply wins,
 * so an operator working inside a client on a trial would get two stacked
 * banners and only one banner's worth of offset — the second covering the top
 * of the inbox.
 *
 * Sitting inside the main scroll area sidesteps that entirely, and `sticky`
 * keeps it visible without any layout arithmetic at all.
 *
 * ── WHY IT IS NOT A MODAL ──
 * Somebody signing in to answer a customer should not have to dismiss a sales
 * interruption first. The 'info' tone can be dismissed; 'warn' and 'block'
 * cannot, because by then it is no longer a nudge — it is the explanation for
 * something that has stopped working.
 *
 * Renders nothing at all for a comped workspace or a trial with more than a
 * week to run, which is the common case and should be silent.
 */
export default async function TrialBanner({
  workspaceId,
}: {
  workspaceId: number;
}) {
  const e = await getWorkspaceEntitlement(workspaceId);
  if (!e) return null;

  const notice = trialNotice(e);
  if (!notice) return null;

  const body = (
    <div className="pbt-banner" data-tone={notice.tone} role="status">
      <span className="pbt-text">
        {notice.message}
        {/*
          Always paired with what still works. Somebody reading a blocked
          banner is worried about their customer mail, and the true answer is
          that it is completely unaffected — saying so here is the difference
          between a nudge and a scare.
        */}
        {notice.tone === "block" && (
          <span className="pbt-reassure">
            Your inbox is working normally and nothing has been deleted.
          </span>
        )}
      </span>
      <Link className="pbt-cta" href="/settings/billing">
        {notice.tone === "block" ? "Choose a plan" : "See plans"}
      </Link>
    </div>
  );

  // Only the gentlest tone can be put away, and only until the number changes.
  if (notice.tone === "info") {
    return (
      <TrialBannerDismiss dismissKey={`trial-${e.daysLeft ?? "x"}`}>
        {body}
      </TrialBannerDismiss>
    );
  }

  return body;
}
