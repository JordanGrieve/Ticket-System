"use client";

import Link from "next/link";
import { STATUS_LABELS, type CampaignRowDTO } from "./composer-model";

/** A navigation parked behind the unsaved-changes question. */
export type PendingNav = { kind: "new" } | { kind: "open"; id: number };

/**
 * The rail: New, the unsaved-changes question when one is pending, the pinned
 * welcome newsletter, and every campaign. Holds no state — which campaign is
 * open, and whether moving away from it is allowed, are the composer's.
 */
export default function CampaignList({
  campaigns,
  currentId,
  loadingId,
  pendingNav,
  welcomeEnabled,
  onNew,
  onOpen,
  onKeepEditing,
  onDiscardAndGo,
}: {
  campaigns: CampaignRowDTO[];
  currentId: number | null;
  loadingId: number | null;
  pendingNav: PendingNav | null;
  welcomeEnabled: boolean;
  onNew: () => void;
  onOpen: (id: number) => void;
  onKeepEditing: () => void;
  onDiscardAndGo: () => void;
}) {
  return (
    <aside className="nl-rail" aria-label="Campaigns">
      <div className="nl-rail-head">
        <h1 className="nl-rail-title">Newsletters</h1>
        <button type="button" className="nl-new" onClick={onNew}>
          New
        </button>
      </div>

      {pendingNav !== null && (
        /* Sits under the rail head, between the two things that can raise
           it — the New button above and the campaign rows below. */
        <div
          className="nl-confirm"
          role="alertdialog"
          aria-label="Unsaved changes"
          aria-describedby="nl-discard-q"
        >
          <p className="nl-confirm-q" id="nl-discard-q">
            You have unsaved changes to this campaign.{" "}
            {pendingNav.kind === "new"
              ? "Starting a new one throws them away."
              : "Opening another one throws them away."}
          </p>
          <div className="nl-confirm-acts">
            <button
              type="button"
              className="nl-confirm-btn"
              autoFocus
              onClick={onKeepEditing}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="nl-confirm-btn nl-confirm-btn--danger"
              onClick={onDiscardAndGo}
            >
              Discard changes
            </button>
          </div>
        </div>
      )}

      {/*
        The welcome newsletter, pinned above the campaigns.

        It is not a campaign and cannot be one: it has no audience, no
        schedule and no send button, because it goes to exactly one person at
        the moment they subscribe. But this is where a client comes looking
        for "the emails my newsletter sends", and it was in Settings — Jordan,
        14 Sep 2026, on this page: "I don't see the newsletter on AMORIA's
        page." A thing nobody can find is a thing nobody edits, and this one
        sends to real customers unedited.

        A link rather than a row that loads into the composer beside it: the
        composer is built around a campaign's lifecycle, and giving it a
        second kind of thing to hold would put scheduling and audience
        controls one state bug away from something that has neither.
      */}
      <Link
        href="/newsletters/welcome"
        className="nl-item nl-item--welcome"
        aria-label={`Welcome newsletter — sent automatically on signup, currently ${
          welcomeEnabled ? "on" : "off"
        }`}
      >
        <span className="nl-item-name">Welcome newsletter</span>
        <span className="nl-item-meta">
          <span className="nl-dot" data-on={welcomeEnabled} aria-hidden />
          {welcomeEnabled ? "Sends on signup" : "Off"}
        </span>
      </Link>

      {campaigns.length === 0 ? (
        <p className="nl-rail-empty">No campaigns yet.</p>
      ) : (
        <ul className="nl-list">
          {campaigns.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="nl-item"
                data-current={c.id === currentId}
                aria-current={c.id === currentId ? "true" : undefined}
                onClick={() => onOpen(c.id)}
                disabled={loadingId !== null}
              >
                <span className="nl-item-top">
                  <span className="nl-item-name">{c.name}</span>
                  <span className="nl-status" data-status={c.status}>
                    {STATUS_LABELS[c.status]}
                  </span>
                </span>
                <span className="nl-item-sub">{c.subject}</span>
                {/*
                  The queued count, or nothing. It used to lead with
                  `c.listName ?? "No audience list"`, which since the list
                  retirement said "No audience list" on every campaign ever
                  — a fact about a model that no longer exists, sitting where
                  a client looks for a fact about their campaign.
                */}
                <span className="nl-item-meta">
                  {c.recipientCount > 0
                    ? `${c.recipientCount} queued`
                    : "Nothing queued yet"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
