import { PostboxLockup } from "@/components/Logo";
import "./unsubscribe.css";

/**
 * Chrome for the public unsubscribe pages.
 *
 * PUBLIC. No Clerk session, no workspace, no database read. Someone acting on
 * a link in an email has no account here and must never be asked for one —
 * requiring a login to unsubscribe is a non-compliant opt-out under PECR and
 * CAN-SPAM, quite apart from being the fastest route to a spam complaint.
 *
 * Note the lockup is NOT a link: it is a wordmark only. A stranger who has
 * just asked to stop hearing from us does not need a funnel back into the
 * product, and the sending workspace is deliberately never named (see the
 * pages — naming it would confirm which tenant holds the address).
 */
export default function UnsubscribeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="u-shell">
      <header className="u-header">
        <PostboxLockup size={30} fontSize={18} color="var(--ink)" />
      </header>
      <main className="u-main">{children}</main>
    </div>
  );
}
