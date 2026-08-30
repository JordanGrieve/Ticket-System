import Link from "next/link";
import { getWorkspaceEntitlement } from "@/lib/billing-query";
import { trialNotice } from "@/lib/trial";
import TrialBannerDismiss from "./TrialBannerDismiss";
import TrialBannerMeasure from "./TrialBannerMeasure";
import "./trial-banner.css";

/**
 * The trial countdown, and the "sending is paused" notice.
 *
 * ── WHERE THIS BELONGS, AND THE MISTAKE THAT GOT HERE ──
 * It is rendered immediately BEFORE `<div className="pb-shell">` in
 * app/(dashboard)/layout.tsx, as a sibling: fixed to the top of the viewport,
 * with the shell buying its height back through a `~` rule. It is now the ONLY
 * thing that does this — ImpersonationBanner used the same mechanism until it
 * became a floating pill, which takes no layout space.
 *
 * It was first put inside `<main className="pb-main">` instead, on the
 * reasoning that two `~ .pb-shell` padding rules would not compose. That was
 * wrong twice over. They composed fine — a compound sibling selector beats
 * either single rule, so the combined offset could be stated explicitly. (That
 * arrangement has since been retired with the bar it composed with, but the
 * reasoning was sound and is worth not re-litigating.) And `.pbm .pb-main` is
 * `flex-direction: row`, because the
 * mail client puts its three panes side by side: a banner placed in there does
 * not span the top at all, it becomes a FOURTH COLUMN, a vertical strip
 * squeezed between the sidebar and the ticket list. Which is exactly how it
 * shipped and exactly how it looked.
 *
 * ── WHY IT IS NOT A MODAL ──
 * Somebody signing in to answer a customer should not have to dismiss a sales
 * interruption first. The 'info' tone can be dismissed; 'warn' and 'block'
 * cannot, because by then it is no longer a nudge — it is the explanation for
 * something that has stopped working.
 *
 * Renders nothing at all for a paid or comped workspace, or a trial with more
 * than a week to run, which is the common case and should be silent.
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

  const inner = (
    <>
      <span className="pbt-text">
        {notice.message}
        {/*
          Always paired with what still works. Somebody reading a blocked
          banner is worried about their customer mail, and the true answer is
          that it is untouched — saying so is the difference between a nudge
          and a scare.
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
    </>
  );

  /*
    Both branches render `.pbt-slot` as their single root. The `~ .pb-shell`
    rules key off that class, so a wrapper present in one tone and absent in
    another would leave the banner overlaying the inbox on exactly the tones
    nobody happened to test.
  */
  if (notice.tone === "info") {
    return (
      <TrialBannerDismiss dismissKey={`trial-${e.daysLeft ?? "x"}`}>
        {inner}
      </TrialBannerDismiss>
    );
  }

  return (
    <div className="pbt-slot" data-tone={notice.tone}>
      <div className="pbt-banner" role="status">
        {inner}
      </div>
      <TrialBannerMeasure />
    </div>
  );
}
