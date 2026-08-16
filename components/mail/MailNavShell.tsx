"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { initials } from "@/lib/tickets";
import { Icon, BrandMark, OverflowIcon, type IconName } from "./icons";
import LabelManager from "./LabelManager";
import type { LabelWithCountDTO, MailCountsDTO } from "./types";

/**
 * The 262px navigation column, and — below 768px — the off-canvas drawer.
 *
 * The interactive half. MailNav.tsx is the server component that feeds it; the
 * split exists because the nav now needs the workspace's labels and the
 * viewer's agent id, and the dashboard layout that renders it is owned
 * elsewhere and cannot be asked for them.
 *
 * The drawer reuses the pb-* classes already in globals.css (pb-sidebar,
 * pb-scrim, pb-topbar, pb-drawer-close). Those solve scroll-locking behind an
 * open drawer via `.pb-shell:has(.pb-scrim) .pb-scroll`, and were measured on a
 * real phone — mail.css only widens the desktop column and repaints them, it
 * does not reimplement the mechanics.
 */

type LiveFolder = {
  key: string;
  label: string;
  icon: IconName;
  count: number;
  href: string;
};

/**
 * Folders the design asks for that still have no table behind them. Rendered
 * as genuinely disabled controls rather than links that go nowhere, and with
 * no count pill at all — a "0" here would read as a fact we do not have.
 *
 * Starred and Labeled used to live in this list. They have tables now, so they
 * are real links above.
 */
const UNBUILT_FOLDERS: { label: string; icon: IconName }[] = [
  { label: "Sent", icon: "send" },
  { label: "Trash", icon: "trash" },
  { label: "Newsletters", icon: "news" },
];

export default function MailNavShell({
  workspaceName,
  userLabel,
  counts,
  labels,
  canPersonalise,
  isAdmin = false,
}: {
  workspaceName: string;
  userLabel: string;
  counts: MailCountsDTO;
  labels: LabelWithCountDTO[];
  /**
   * The viewer has an agent row in this workspace, so Unread and Starred mean
   * something. False for a super-admin acting inside a client — those two
   * folders are hidden rather than shown reading zero.
   */
  canPersonalise: boolean;
  isAdmin?: boolean;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Esc closes the drawer.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Standard menu semantics: Esc and clicking anywhere else close it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);

  const onList = pathname === "/inbox";
  const activeLabel = onList ? searchParams.get("label") : null;
  // A per-label view is its own selection; the "Labeled" folder above it is
  // "any label at all", so only one of the two should ever look active.
  const activeFolder =
    onList && !activeLabel ? (searchParams.get("folder") ?? "inbox") : "";

  const folders: LiveFolder[] = [
    { key: "all", label: "All mail", icon: "mail", count: counts.all, href: "/inbox?folder=all" },
    ...(canPersonalise
      ? [
          {
            key: "unread",
            label: "Unread",
            icon: "envelopeOpen" as IconName,
            count: counts.unread,
            href: "/inbox?folder=unread",
          },
        ]
      : []),
    {
      key: "awaiting",
      label: "Awaiting reply",
      icon: "lines",
      count: counts.awaiting,
      href: "/inbox?folder=awaiting",
    },
    { key: "inbox", label: "Open", icon: "mail", count: counts.inbox, href: "/inbox" },
    {
      key: "closed",
      label: "Closed",
      icon: "check",
      count: counts.closed,
      href: "/inbox?folder=closed",
    },
    ...(canPersonalise
      ? [
          {
            key: "starred",
            label: "Starred",
            icon: "star" as IconName,
            count: counts.starred,
            href: "/inbox?folder=starred",
          },
        ]
      : []),
    {
      key: "labeled",
      label: "Labeled",
      icon: "label",
      count: counts.labeled,
      href: "/inbox?folder=labeled",
    },
  ];

  return (
    <>
      {/* Mobile top bar. Hidden above 768px by globals.css. Deliberately not
          rendered on a thread route: the thread has its own header with a back
          button, and 56px of extra chrome is a lot of a 390px screen. */}
      {!pathname.startsWith("/tickets/") && (
        <header className="pb-topbar pbm-topbar">
          <button
            className="pbm-burger"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="pbm-topbar-text">
            <div className="pbm-topbar-name">{workspaceName}</div>
            <div className="pbm-topbar-sub">
              {isAdmin ? "viewing as admin" : "postbox"}
            </div>
          </div>
        </header>
      )}

      {navOpen && (
        <div className="pb-scrim" onClick={() => setNavOpen(false)} aria-hidden />
      )}

      <nav
        className="pb-sidebar pbm-nav"
        data-open={navOpen}
        aria-label="Mail folders"
        // Tapping any link in the drawer navigates, so the drawer must close.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setNavOpen(false);
        }}
      >
        <button
          className="pb-drawer-close pbm-drawer-close"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation"
        >
          <Icon name="close" size={15} strokeWidth={2.4} />
        </button>

        <div className="pbm-brand">
          <span className="pbm-brand-mark">
            <BrandMark size={20} />
          </span>
          <span className="pbm-brand-name">{workspaceName}</span>
        </div>

        {isAdmin && (
          <Link href="/admin" className="pbm-admin-link">
            <span aria-hidden>←</span> All clients
          </Link>
        )}

        <div className="pbm-folders">
          {folders.map((f) => {
            const active = activeFolder === f.key;
            return (
              <Link
                key={f.key}
                href={f.href}
                className="pbm-folder"
                data-active={active}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={f.icon} size={18} />
                <span className="pbm-folder-label">{f.label}</span>
                <span className="pbm-folder-count">{f.count}</span>
              </Link>
            );
          })}
        </div>

        <div className="pbm-nav-divider" />

        <div className="pbm-nav-heading-row">
          <p className="pbm-nav-heading">Labels</p>
          <button
            type="button"
            className="pbm-nav-manage"
            onClick={() => setLabelsOpen(true)}
            aria-label="Manage labels"
          >
            Manage
          </button>
        </div>
        <div className="pbm-folders">
          {labels.length === 0 ? (
            <p className="pbm-nav-note">
              No labels yet. &ldquo;Manage&rdquo; makes the first one.
            </p>
          ) : (
            labels.map((l) => {
              const active = activeLabel === String(l.id);
              return (
                <Link
                  key={l.id}
                  href={`/inbox?folder=labeled&label=${l.id}`}
                  className="pbm-folder"
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="pbm-label-swatch" data-color={l.color} aria-hidden />
                  <span className="pbm-folder-label">{l.name}</span>
                  <span className="pbm-folder-count">{l.ticketCount}</span>
                </Link>
              );
            })
          )}
        </div>

        <div className="pbm-nav-divider" />

        <p className="pbm-nav-heading">Not built yet</p>
        <div className="pbm-folders">
          {UNBUILT_FOLDERS.map((f) => (
            <button
              key={f.label}
              type="button"
              className="pbm-folder pbm-folder--dead"
              disabled
              title={`${f.label} isn't available yet — there's no data behind it.`}
            >
              <Icon name={f.icon} size={18} />
              <span className="pbm-folder-label">{f.label}</span>
              <span className="pbm-folder-soon">soon</span>
            </button>
          ))}
        </div>

        <div className="pbm-nav-divider" />

        <div className="pbm-folders">
          <Link
            href="/contacts"
            className="pbm-folder"
            data-active={pathname === "/contacts"}
          >
            <Icon name="people" size={18} />
            <span className="pbm-folder-label">Contacts</span>
          </Link>
          <Link
            href="/settings"
            className="pbm-folder"
            data-active={pathname === "/settings"}
          >
            <Icon name="settings" size={18} />
            <span className="pbm-folder-label">Auto-reply</span>
          </Link>
          {/* Relabelled from "Settings" now that /settings exists — two nav
              entries both called Settings would be a coin toss. */}
          <Link
            href="/install"
            className="pbm-folder"
            data-active={pathname === "/install"}
          >
            <Icon name="clip" size={18} />
            <span className="pbm-folder-label">Install</span>
          </Link>
        </div>

        <div className="pbm-nav-spacer" />

        {/* Account + sign out. The design has no such block, but sign-out has
            to stay reachable from the shell. */}
        <div className="pbm-account" ref={menuRef}>
          <button
            className="pbm-account-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Account menu for ${userLabel}`}
          >
            <span className="pbm-avatar" aria-hidden>
              {initials(userLabel)}
            </span>
            <span className="pbm-account-text">
              <span className="pbm-account-name">{userLabel}</span>
              <span className="pbm-account-role">
                {isAdmin ? "Admin" : "Owner"}
              </span>
            </span>
            <OverflowIcon size={15} />
          </button>
          {menuOpen && (
            <div className="pbm-menu" role="menu">
              <Link
                href="/install"
                role="menuitem"
                className="pbm-menu-item"
                onClick={() => setMenuOpen(false)}
              >
                Settings &amp; install
              </Link>
              <SignOutButton>
                <button role="menuitem" className="pbm-menu-item pbm-menu-item--danger">
                  Sign out
                </button>
              </SignOutButton>
            </div>
          )}
        </div>

        {/* Plans are not modelled anywhere — no table, no price, no entitlement.
            The card keeps its place in the layout and says exactly that instead
            of quoting the design's "$18/mo". */}
        <aside className="pbm-pro">
          <p className="pbm-pro-title">Postbox Pro</p>
          <p className="pbm-pro-body">
            Shared inboxes, newsletters and segments. Plans and billing aren&rsquo;t
            built yet, so there is nothing to upgrade to.
          </p>
          <button className="pbm-pro-btn" disabled title="Billing isn't available yet.">
            Not available yet
          </button>
        </aside>
      </nav>

      {labelsOpen && (
        <LabelManager labels={labels} onClose={() => setLabelsOpen(false)} />
      )}
    </>
  );
}
