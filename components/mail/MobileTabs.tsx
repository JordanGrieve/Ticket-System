"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "./icons";

/**
 * The floating bottom tab bar from the mobile design. Hidden above 768px, and
 * only rendered on the list screen (the thread screen needs that space for the
 * composer, which is what the design does too).
 */

const TABS: { key: string; label: string; icon: IconName; href: string }[] = [
  { key: "inbox", label: "Open", icon: "mail", href: "/inbox" },
  { key: "awaiting", label: "Awaiting", icon: "lines", href: "/inbox?folder=awaiting" },
  { key: "all", label: "All", icon: "news", href: "/inbox?folder=all" },
  { key: "settings", label: "Settings", icon: "settings", href: "/install" },
];

export default function MobileTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const folder = pathname === "/inbox" ? (searchParams.get("folder") ?? "inbox") : "";
  const active = pathname === "/install" ? "settings" : folder;

  return (
    <nav className="pbm-tabs" aria-label="Sections">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className="pbm-tab"
          data-on={active === t.key || undefined}
          aria-current={active === t.key ? "page" : undefined}
        >
          <Icon name={t.icon} size={21} />
          <span>{t.label}</span>
        </Link>
      ))}
      {/* Starred would be the fourth tab in the design. It is left out rather
          than shipped as a dead tab: a tab bar is a primary control and a
          disabled one on a phone is just a trap for a thumb. */}
    </nav>
  );
}
