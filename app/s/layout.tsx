import { PostboxLockup } from "@/components/Logo";
import "./subscribe.css";

/**
 * Chrome for the public newsletter signup pages.
 *
 * PUBLIC. No Clerk session, no workspace context, no authentication anywhere
 * beneath it — the people using these pages have no account here and must
 * never be asked for one.
 *
 * The lockup is not a link, matching app/u/layout.tsx. On the unsubscribe
 * pages that is because somebody leaving does not need a funnel back into the
 * product; here it is because these pages are the client's signup flow, and
 * turning their subscribers into our traffic is not what they pasted the
 * snippet for.
 */
export default function SubscribeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="s-shell">
      <header className="s-header">
        <PostboxLockup size={30} fontSize={18} color="var(--ink)" />
      </header>
      <main className="s-main">{children}</main>
    </div>
  );
}
