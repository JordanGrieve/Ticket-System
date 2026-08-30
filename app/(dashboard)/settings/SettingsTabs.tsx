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
   * BACK, 30 August, on Jordan's call — off on the 28th, on again now.
   *
   * The two days it was gone changed what it can say. When it came off, the
   * page could only tell a client that somebody entered; it now also names the
   * tickets they opened, because impersonation_reads exists. That is the
   * difference between "someone was in your inbox for 40 minutes" and "someone
   * opened these three conversations", and it is the version of the page worth
   * having.
   *
   * The recording never stopped while the page was away, which is why there is
   * a log to show rather than two days of silence.
   */
  { href: "/settings/access-log", label: "Access log" },
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
