"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "./icons";

/**
 * The floating bottom tab bar from the mobile design. Hidden above 768px, and
 * only rendered on the list screen (the thread screen needs that space for the
 * composer, which is what the design does too).
 */

type Tab = { key: string; label: string; icon: IconName; href: string };

const BASE_TABS: Tab[] = [
  { key: "inbox", label: "Open", icon: "mail", href: "/inbox" },
  { key: "awaiting", label: "Awaiting", icon: "lines", href: "/inbox?folder=awaiting" },
  { key: "all", label: "All", icon: "news", href: "/inbox?folder=all" },
  { key: "settings", label: "Settings", icon: "settings", href: "/settings" },
];

/** Starred is the design's fourth tab. It is real now, so it goes in — but
 *  only for a viewer who has an agent row here, since a super-admin has no
 *  stars and a tab that is always empty is worse than no tab. */
const STARRED_TAB: Tab = {
  key: "starred",
  label: "Starred",
  icon: "star",
  href: "/inbox?folder=starred",
};

export default function MobileTabs({
  canPersonalise = false,
}: {
  canPersonalise?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const folder = pathname === "/inbox" ? (searchParams.get("folder") ?? "inbox") : "";
  const active = pathname.startsWith("/settings") ? "settings" : folder;
  const TABS = canPersonalise
    ? [...BASE_TABS.slice(0, 3), STARRED_TAB, BASE_TABS[3]]
    : BASE_TABS;

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
    </nav>
  );
}
