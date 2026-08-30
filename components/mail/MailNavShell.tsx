"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
// Not Clerk's <SignOutButton>: an operator signing out from inside a client
// workspace has an open audit row to close first. See the component's header.
import AuditedSignOutButton from "@/components/AuditedSignOutButton";
// Not "@/lib/tickets": that reaches lib/config, which is server-only. See the
// header of lib/ticket-format.ts.
import { initials } from "@/lib/ticket-format";
import { Icon, BrandMark, OverflowIcon, type IconName } from "./icons";
import LabelManager from "./LabelManager";
import { subscribeStar } from "./live";
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
 * Starred, Labeled and now Sent used to live in this list. They have tables
 * now, so they are real links above.
 *
 * Trash stays. It is not waiting on a query, it is waiting on a decision:
 * `tickets` has no deleted/archived column, and in an inbox holding customer
 * correspondence "delete" is a retention question (hide it, keep the audit
 * trail, or actually destroy it?) rather than a WHERE clause. Guessing would
 * ship a button whose meaning we would have to change later.
 */
/*
 * EMPTY as of 23 August 2026. Trash was the last entry and is now a real
 * folder above — deleting hides a ticket for 30 days, then a sweep destroys
 * it, which is what every mail client a client already uses means by "delete".
 *
 * The list and the "Not built yet" heading are kept rather than removed. They
 * cost nothing while empty, they render nothing, and the next feature the
 * design asks for before its data exists has somewhere honest to sit. Deleting
 * the mechanism is how the next one ends up as a link that goes nowhere.
 */
const UNBUILT_FOLDERS: { label: string; icon: IconName }[] = [];

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
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Local correction to `counts.starred`, so a star click updates this number
   * without a `router.refresh()` of the entire route. See ./live.ts.
   *
   * The delta is thrown away the instant the server sends a new `counts`
   * object — every navigation and every periodic list refresh does that — so
   * this can drift by one at most, and only until the next server word.
   */
  const [starredDelta, setStarredDelta] = useState(0);
  const [lastCounts, setLastCounts] = useState(counts);
  if (lastCounts !== counts) {
    setLastCounts(counts);
    setStarredDelta(0);
  }

  useEffect(
    () => subscribeStar(({ starred }) => setStarredDelta((d) => d + (starred ? 1 : -1))),
    [],
  );

  // Clamped: a star added on another device, then removed here, would otherwise
  // show "-1". A count is never negative, whatever the arithmetic says.
  const starredCount = Math.max(0, counts.starred + starredDelta);

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

  /*
   * The folders that stay visible when the list is collapsed: the three
   * somebody works out of. Everything else is a place you look something up.
   */
  const PRIMARY_FOLDERS = ["inbox", "unread", "awaiting"];

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
    // Not gated on canPersonalise: "did anyone here reply" is a fact about the
    // workspace, so it reads the same for an operator viewing a client as it
    // does for the team. Unread and Starred are the personal ones.
    { key: "sent", label: "Sent", icon: "send", count: counts.sent, href: "/inbox?folder=sent" },
    ...(canPersonalise
      ? [
          {
            key: "starred",
            label: "Starred",
            icon: "star" as IconName,
            count: starredCount,
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
    /*
     * Snoozed sits above Archived, and both sit below the working folders.
     *
     * Snoozed is the one folder whose contents change with no one doing
     * anything — a ticket leaves it when its time arrives, because the state
     * is `snoozed_until > now()` rather than a stored flag. So its count is
     * the count of things that WILL come back, and it belongs near the folders
     * somebody actually works out of rather than down with Trash.
     */
    {
      key: "snoozed",
      label: "Snoozed",
      icon: "clock",
      count: counts.snoozed,
      href: "/inbox?folder=snoozed",
    },
    {
      key: "archived",
      label: "Archived",
      icon: "archive",
      count: counts.archived,
      href: "/inbox?folder=archived",
    },
    /*
     * Trash is a real folder as of 23 August 2026. It sits last because it is
     * where things go, not somewhere anybody works — and unlike the folders
     * above, its count going up is not progress.
     */
    {
      key: "trash",
      label: "Trash",
      icon: "trash",
      count: counts.trash,
      href: "/inbox?folder=trash",
    },
  ];

  /*
   * The collapsed set: the primaries, plus the active folder when it is not
   * one of them. The order of `folders` is preserved rather than the order of
   * PRIMARY_FOLDERS, so nothing jumps around as the list expands.
   */
  const alwaysShown = folders.filter(
    (f) => PRIMARY_FOLDERS.includes(f.key) || f.key === activeFolder,
  );
  const extraFolders = folders.filter((f) => !alwaysShown.includes(f));

  /*
   * ── COUNTED FROM THE COLLAPSED SET, NOT THE CURRENT ONE ──
   * This used to be `folders.length - shownFolders.length`, which is zero
   * while the list is OPEN — so the button that says "Less" unmounted the
   * moment it was pressed and there was no way to collapse the list again.
   * A disclosure that can only be opened is not a disclosure.
   *
   * The number of hidden folders is a property of the collapsed layout, so it
   * has to be computed from that rather than from whatever state the list
   * happens to be in.
   */
  const collapsibleCount = extraFolders.length;

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

        {/*
          THREE FOLDERS, THEN "MORE".

          There are eleven, and a sidebar of eleven is a list you scan rather
          than a set of places you go. The three kept are the ones somebody
          working the inbox actually moves between during a shift — what is
          open, what has not been read, what is waiting on us. The other eight
          answer "where did that go?", which is a question you ask
          occasionally, not a place you live.

          The active folder is ALWAYS shown, even when it is one of the eight.
          Collapsing the list while somebody is looking at Trash would hide the
          only thing on screen explaining why the list looks the way it does.
        */}
        <div className="pbm-folders">
          {alwaysShown.map((f) => {
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

          {/*
            The rest, in a container that animates its own height.

            The 0fr-to-1fr grid trick rather than a max-height guess: the
            number of extra folders varies with the plan and with whether the
            viewer has an agent row, so there is no height to hard-code. A
            max-height large enough for the longest case makes the short case
            animate at the wrong speed and then sit still.

            They stay in the DOM and are hidden with inert + aria-hidden, so
            the height has something to animate FROM and TO. Rendering them
            conditionally would snap.
          */}
          {collapsibleCount > 0 && (
            <div
              className="pbm-folders-extra"
              data-open={foldersOpen || undefined}
              inert={!foldersOpen}
              aria-hidden={!foldersOpen}
            >
              <div className="pbm-folders-extra-inner">
                {extraFolders.map((f) => {
                  const active = activeFolder === f.key;
                  return (
                    <Link
                      key={f.key}
                      href={f.href}
                      className="pbm-folder"
                      data-active={active}
                      aria-current={active ? "page" : undefined}
                      tabIndex={foldersOpen ? undefined : -1}
                    >
                      <Icon name={f.icon} size={18} />
                      <span className="pbm-folder-label">{f.label}</span>
                      <span className="pbm-folder-count">{f.count}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {collapsibleCount > 0 && (
            <button
              type="button"
              className="pbm-folder pbm-folder--more"
              data-open={foldersOpen || undefined}
              onClick={() => setFoldersOpen((v) => !v)}
              aria-expanded={foldersOpen}
            >
              {/* One glyph, rotated by CSS. A second near-identical
                  chevron in the icon set is a thing that can drift out of
                  step with this one. */}
              <Icon name="chevronDown" size={18} />
              <span className="pbm-folder-label">
                {foldersOpen ? "Less" : "More"}
              </span>
            </button>
          )}
        </div>

        <div className="pbm-nav-divider" />

        {/*
          Hidden entirely when the workspace has no labels. It used to render a
          heading, a Manage button and a two-line note explaining a feature the
          reader was not using — permanent furniture for an empty list.

          This could only become conditional once /settings/labels existed:
          "Manage" was the sole way to create a first label, so hiding the block
          before there was another route to it would have removed the feature
          for exactly the workspaces that had never used it.
        */}
        {labels.length > 0 && (
          <>
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
              {labels.map((l) => {
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
              })}
            </div>

            <div className="pbm-nav-divider" />
          </>
        )}

        {/*
          Guarded on length. UNBUILT_FOLDERS is empty now that Trash is real,
          and an unguarded map would leave the "Not built yet" heading sitting
          above nothing — a section announcing an absence, which reads as a
          rendering fault rather than as an empty list.
        */}
        {UNBUILT_FOLDERS.length > 0 && (
          <>
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
          </>
        )}

        <div className="pbm-folders">
          {/* Contacts, Auto-reply and Install are all "things you configure
              about this workspace", so they are one entry here and tabs inside
              /settings. Three separate links made an already long sidebar
              longer and read as unrelated to each other. */}
          {/*
            NO SEARCH ENTRY HERE, as of 23 August 2026.

            It was added because /search, lib/search.ts and /api/search were
            built and nothing linked to them. That was the right problem and
            the wrong fix: this sidebar already carries eleven folders plus
            labels, and a twelfth row made the list longer without making
            search easier to find. There is a search box at the top of the
            message list, which is where somebody looks for one.

            The route still exists and still works. If workspace-wide search
            needs a way in from here later, it belongs in that box — as a
            "search everything" affordance when the on-page filter finds
            nothing — not as another row competing with the folders.
          */}
          <Link
            href="/newsletters"
            className="pbm-folder"
            data-active={pathname.startsWith("/newsletters")}
          >
            <Icon name="news" size={18} />
            <span className="pbm-folder-label">Newsletters</span>
          </Link>
          {/* The audience behind the newsletters, so it sits next to them
              rather than in /settings: who is on the list is not a setting. */}
          <Link
            href="/subscribers"
            className="pbm-folder"
            data-active={pathname.startsWith("/subscribers")}
          >
            <Icon name="people" size={18} />
            <span className="pbm-folder-label">Subscribers</span>
          </Link>
          <Link
            href="/settings"
            className="pbm-folder"
            data-active={pathname.startsWith("/settings")}
          >
            <Icon name="settings" size={18} />
            <span className="pbm-folder-label">Settings</span>
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
                href="/settings"
                role="menuitem"
                className="pbm-menu-item"
                onClick={() => setMenuOpen(false)}
              >
                Settings
              </Link>
              <AuditedSignOutButton
                role="menuitem"
                className="pbm-menu-item pbm-menu-item--danger"
              >
                Sign out
              </AuditedSignOutButton>
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
