"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Segmented tab strip for the settings surfaces.
 *
 * A client component only because it needs the current pathname to mark the
 * active tab; everything inside each tab stays a server component.
 *
 * Rendered as a real <nav> with aria-current rather than a row of buttons, so
 * these stay ordinary links — middle-clickable, and each tab has its own URL.
 */
const TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/auto-reply", label: "Auto-reply" },
  { href: "/settings/contacts", label: "Contacts" },
  { href: "/settings/labels", label: "Labels" },
  { href: "/settings/forms", label: "Forms" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/install", label: "Install" },
  /*
   * NO ACCESS LOG TAB, removed 28 August on Jordan's call.
   *
   * It showed a client every time somebody at Postbox opened their workspace.
   * The RECORDING has not changed — impersonation_sessions is still written on
   * every entry and exit, the operator is still asked why they are going in,
   * and the admin console still shows all of it. What is gone is the
   * client-facing page.
   *
   * Worth knowing if this is ever reconsidered: the privacy policy does not
   * promise this page, so removing it did not make that document untrue. If it
   * comes back, the data to fill it was never dropped.
   */
] as const;

export default function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav className="pbs-tabs" aria-label="Settings sections">
      {TABS.map((t) => {
        // Exact match: /settings must not light up while on /settings/contacts.
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="pbs-tab"
            data-active={active}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
