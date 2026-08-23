"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TicketDTO, MessageDTO } from "@/lib/serialize";
import { formatDateTime } from "@/lib/serialize";
import type { TicketStatus } from "@/db/schema";
import { SOURCE_META, STATUS_META, STATUS_ORDER } from "@/lib/theme";
import { Icon, OverflowIcon } from "./icons";
import ContactRail from "./ContactRail";
import type { ContactNoteDTO } from "@/app/(dashboard)/queries";
import type { SharedLink } from "@/lib/shared-links";
import { describeRetention, describeDeletedBy } from "@/lib/trash";
import { describeDeliveryStatus } from "@/lib/delivery-events";
import { SNOOZE_OPTIONS } from "@/lib/snooze";
import LabelPicker from "./LabelPicker";
import StarButton from "./StarButton";
import type { ContactCard, LabelChipDTO } from "./types";

/**
 * The conversation pane, plus the contact rail it can open.
 *
 * Everything that writes — replies and status changes — goes through the
 * existing authed API routes unchanged, so tenancy is still enforced
 * server-side. Nothing new is persisted here.
 */

export default function Thread({
  ticket,
  messages,
  hasOlderMessages = false,
  fromAddress,
  contact,
  notes,
  addNote,
  deleteNote,
  links,
  deletedAt,
  deletedBy,
  trashTicket,
  restoreTicket,
  archivedAt,
  snoozedUntil,
  wakeIn,
  archiveTicket,
  unarchiveTicket,
  snoozeTicket,
  unsnoozeTicket,
  backHref,
  starred,
  unread,
  labels,
  allLabels,
  canPersonalise,
}: {
  ticket: TicketDTO;
  messages: MessageDTO[];
  hasOlderMessages?: boolean;
  fromAddress: string;
  contact: ContactCard;
  /** Internal notes about this contact, newest first. */
  notes: ContactNoteDTO[];
  /**
   * The note server actions, passed down rather than imported. This is a
   * client file: importing a "use server" module here would bundle a reference
   * to every export in it, and the rule in this codebase is that those modules
   * are reached from Server Components only.
   */
  addNote: (formData: FormData) => void;
  deleteNote: (formData: FormData) => void;
  /** Derived from message bodies at read time — see lib/shared-links.ts. */
  links: SharedLink[];
  /**
   * ISO timestamp if this ticket is in the trash, else null.
   *
   * Drives the delete/restore toggle and the banner. A string rather than a
   * Date because everything crossing into this client component is serialised.
   */
  deletedAt: string | null;
  /** Email snapshot of whoever deleted it. See tickets.deletedBy. */
  deletedBy: string | null;
  /** Server actions, passed down: this is a client file. */
  trashTicket: (formData: FormData) => void;
  restoreTicket: (formData: FormData) => void;
  /** ISO timestamp if archived, else null. Drives the archive/unarchive toggle. */
  archivedAt: string | null;
  /**
   * ISO timestamp this ticket is hidden until, or null if it is not snoozed.
   *
   * ── THE SERVER DECIDES WHETHER IT IS SNOOZED; THIS FILE ONLY FORMATS IT ──
   * Non-null means "still snoozed as of the render". Re-testing the time here
   * would make the BANNER'S EXISTENCE depend on the clock, and a server render
   * either side of the wake time from its hydration would then be a mismatch
   * React cannot reconcile. Deciding once, on the server, removes the class.
   *
   * The formatting stays here on purpose, for the opposite reason: a time
   * formatted on the server renders UTC for everybody. Same rule as
   * MessageDTO.sentAtIso.
   */
  snoozedUntil: string | null;
  /**
   * "in 3 hours" — computed on the SERVER, because a relative duration carries
   * no timezone and so is safe to compute there, unlike the absolute time
   * beside it.
   */
  wakeIn: string | null;
  archiveTicket: (formData: FormData) => void;
  unarchiveTicket: (formData: FormData) => void;
  snoozeTicket: (formData: FormData) => void;
  unsnoozeTicket: (formData: FormData) => void;
  backHref: string;
  /** Per-agent state. Both false when the viewer has no agent row here. */
  starred: boolean;
  unread: boolean;
  labels: LabelChipDTO[];
  /** Every label in the workspace, for the picker. */
  allLabels: LabelChipDTO[];
  canPersonalise: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  /**
   * Three states, not two. The rail should start open as a column on a wide
   * screen and closed as an overlay on a narrow one — a single boolean cannot
   * express that without measuring the viewport, which the server cannot do and
   * which would cost a layout shift after hydration. "auto" lets a media query
   * in mail.css make that first decision; a click resolves it either way.
   */
  const [rail, setRail] = useState<"auto" | "open" | "closed">("auto");
  const [wide, setWide] = useState(false);
  const railOpen = rail === "auto" ? wide : rail === "open";
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Esc / click-outside close the status menu.
  useEffect(() => {
    if (!statusMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStatusMenuOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!statusRef.current?.contains(e.target as Node)) setStatusMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [statusMenuOpen]);

  // Esc / click-outside close the snooze menu. Same shape as the status menu
  // above; kept as its own effect rather than merged so closing one cannot
  // close the other by accident.
  useEffect(() => {
    if (!snoozeMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSnoozeMenuOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!snoozeRef.current?.contains(e.target as Node)) setSnoozeMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [snoozeMenuOpen]);

  // Mirrors the mail.css breakpoint. Only used to keep aria-expanded truthful
  // while the rail is still in its "auto" state — layout is CSS's job.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1181px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Below 1180px the rail is an overlay over the thread, so Esc must close it.
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRail("closed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [railOpen]);

  // Customer replies should appear without a manual reload.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  // Land on the newest message, like every other messaging client.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  /**
   * Opening a thread marks it read for this agent.
   *
   * Deliberately a POST from the client rather than a write inside the page's
   * server render: the render is a GET that Next also runs to satisfy a
   * prefetch, so writing there would mark mail read merely because a link in
   * the list was hovered.
   *
   * The refresh afterwards is only worth its round trip when the ticket was
   * actually unread — that is the case where the nav's Unread count and the
   * row's dot are now stale.
   */
  useEffect(() => {
    if (!canPersonalise) return;
    let cancelled = false;
    const wasUnread = unread;
    void fetch(`/api/tickets/${ticket.id}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    }).then(() => {
      if (!cancelled && wasUnread) router.refresh();
    });
    return () => {
      cancelled = true;
    };
    // Once per thread. `unread` is read at mount on purpose: re-running this
    // when the refresh flips it to false would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, canPersonalise]);

  const st = STATUS_META[status];
  const src = SOURCE_META[ticket.source];
  const canSend = replyText.trim().length > 0 && !sending;

  async function changeStatus(next: TicketStatus) {
    setStatusMenuOpen(false);
    if (next === status) return;
    const prev = status;
    setStatus(next);
    const res = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      setStatus(prev);
      setError("Couldn't update status.");
      return;
    }
    router.refresh();
  }

  /**
   * Put this thread back in my unread pile, and leave — reading on is exactly
   * what would undo it (the mount effect has already fired, but a reload would
   * re-mark it), and going back to the list is what the gesture means.
   */
  async function markUnread() {
    const res = await fetch(`/api/tickets/${ticket.id}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: false }),
    });
    if (!res.ok) {
      setError("Couldn't mark this unread.");
      return;
    }
    router.push(backHref);
  }

  async function sendReply() {
    const message = replyText.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticket.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    setSending(false);
    if (!res.ok) {
      setError("Couldn't send your reply. Please try again.");
      return;
    }
    const data = (await res.json()) as { emailSent?: boolean };
    setReplyText("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    if (status !== "closed") setStatus("in_progress");
    if (data.emailSent === false) {
      setError("Saved to the thread, but email delivery isn't configured yet.");
    }
    router.refresh();
  }

  const countLabel = hasOlderMessages
    ? `latest ${messages.length} messages`
    : `${messages.length} ${messages.length === 1 ? "message" : "messages"}`;

  return (
    <>
      <section className="pbm-thread" aria-label="Conversation">
        <header className="pbm-thread-head">
          <Link href={backHref} className="pbm-icon-btn pbm-back" aria-label="Back to the list">
            <Icon name="back" size={17} strokeWidth={2.2} />
          </Link>
          <div className="pbm-thread-who">
            <p className="pbm-thread-name">{ticket.customerName}</p>
            <p className="pbm-thread-email">{ticket.customerEmail}</p>
          </div>
          <div className="pbm-thread-actions">
            <StarButton
              ticketId={ticket.id}
              starred={starred}
              canStar={canPersonalise}
            />
            {canPersonalise && (
              <button
                className="pbm-icon-btn"
                onClick={() => void markUnread()}
                aria-label="Mark as unread and go back"
                title="Mark as unread — this thread goes back into your unread pile and you return to the list."
              >
                <Icon name="envelopeOpen" size={17} strokeWidth={1.8} />
              </button>
            )}
            {/*
              Snooze and archive, hidden while the ticket is in the trash.

              A deleted ticket is already out of every working folder, so
              offering to hide it again would be offering an action with no
              effect — and both buttons would compete with Restore, which is
              the only thing anybody wants on that screen.
            */}
            {!deletedAt && (
              <>
                <div className="pbm-snooze" ref={snoozeRef}>
                  {snoozedUntil ? (
                    <form action={unsnoozeTicket}>
                      <input type="hidden" name="ticketId" value={ticket.id} />
                      <button
                        className="pbm-icon-btn pbm-icon-btn--on"
                        type="submit"
                        aria-label="Wake this thread now"
                        title="Snoozed — bring it back now"
                      >
                        <Icon name="clock" size={17} strokeWidth={1.8} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="pbm-icon-btn"
                        onClick={() => setSnoozeMenuOpen((v) => !v)}
                        aria-haspopup="menu"
                        aria-expanded={snoozeMenuOpen}
                        aria-label="Snooze this thread"
                        title="Snooze — it comes back to the inbox on its own"
                      >
                        <Icon name="clock" size={17} strokeWidth={1.8} />
                      </button>
                      {snoozeMenuOpen && (
                        <div className="pbm-menu pbm-menu--snooze" role="menu">
                          {SNOOZE_OPTIONS.map((o) => (
                            <form
                              key={o.minutes}
                              action={snoozeTicket}
                              onSubmit={() => setSnoozeMenuOpen(false)}
                            >
                              <input type="hidden" name="ticketId" value={ticket.id} />
                              <input type="hidden" name="minutes" value={o.minutes} />
                              <button
                                role="menuitem"
                                className="pbm-menu-item"
                                type="submit"
                              >
                                {o.label}
                              </button>
                            </form>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <form action={archivedAt ? unarchiveTicket : archiveTicket}>
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <button
                    className={
                      archivedAt ? "pbm-icon-btn pbm-icon-btn--on" : "pbm-icon-btn"
                    }
                    type="submit"
                    aria-label={
                      archivedAt
                        ? "Move this thread back to the inbox"
                        : "Archive this thread"
                    }
                    title={
                      archivedAt
                        ? "Archived — put it back in the inbox"
                        : "Archive — off your inbox, still open, still findable"
                    }
                  >
                    <Icon name="archive" size={17} strokeWidth={1.8} />
                  </button>
                </form>
              </>
            )}
            {/*
              Delete, or restore if this one is already in the trash.

              No confirmation dialog, deliberately. Deleting is reversible for
              30 days and the trash says so, which is exactly the trade that
              makes a confirm step unnecessary — an "are you sure?" on a
              reversible action trains people to click through the ones that
              are not. The undo IS the safety.
            */}
            {deletedAt ? (
              <form action={restoreTicket}>
                <input type="hidden" name="ticketId" value={ticket.id} />
                <button
                  className="pbm-icon-btn"
                  type="submit"
                  aria-label="Restore this thread from the trash"
                  title="Restore this thread"
                >
                  <Icon name="mail" size={17} strokeWidth={1.8} />
                </button>
              </form>
            ) : (
              <form action={trashTicket}>
                <input type="hidden" name="ticketId" value={ticket.id} />
                <button
                  className="pbm-icon-btn"
                  type="submit"
                  aria-label="Move this thread to the trash"
                  title="Move to trash — recoverable for 30 days"
                >
                  <Icon name="trash" size={17} strokeWidth={1.8} />
                </button>
              </form>
            )}
            <button
              className="pbm-icon-btn"
              onClick={() => setRail(railOpen ? "closed" : "open")}
              aria-expanded={railOpen}
              aria-label={railOpen ? "Hide contact details" : "Show contact details"}
            >
              <OverflowIcon size={17} />
            </button>
          </div>
        </header>

        {/*
          The retention promise, stated where somebody is looking at the thread
          it applies to. A trash folder that does not say when things go is one
          people are afraid to use and equally afraid to empty — and the whole
          reason deleting is safe here is the 30 days, so hiding that undoes
          the design.
        */}
        {deletedAt && (
          <p className="pbm-trashed" role="status">
            <b>In the trash.</b>{" "}
            {describeRetention(new Date(deletedAt), new Date())} Deleted by{" "}
            {describeDeletedBy(deletedBy)}. Restore it with the button above and
            it goes back where it was.
          </p>
        )}

        {/*
          Says what state the thread is in and how to leave it.

          Archived and snoozed are both "why is this not in my inbox?", and a
          thread that answers that on its own page is one nobody has to go and
          check a folder for.

          The condition is a plain null check, NOT a comparison against the
          clock. The server has already decided — it sends `snoozedUntil` only
          while the ticket is actually hidden. Re-testing the time here would
          make this element's EXISTENCE depend on the moment it renders, and a
          server render either side of the wake time from its hydration is a
          mismatch React cannot reconcile. The absolute time inside is still
          formatted in the browser, because a server-formatted time shows UTC
          to everybody.
        */}
        {!deletedAt && snoozedUntil && (
          <p className="pbm-snoozed" role="status" suppressHydrationWarning>
            <b>Snoozed.</b> Hidden until {formatDateTime(snoozedUntil)}
            {wakeIn ? ` (${wakeIn})` : ""}. It returns to the inbox on its own —
            or press the clock above to bring it back now.
          </p>
        )}
        {!deletedAt && !snoozedUntil && archivedAt && (
          <p className="pbm-snoozed" role="status">
            <b>Archived.</b> Off the inbox, but not closed and not deleted. It
            still appears in All, Search and any label it carries.
          </p>
        )}

        <div className="pbm-thread-subject">
          <h1 className="pbm-subject">{ticket.subject}</h1>
          <div className="pbm-subject-chips">
            <span className="pbm-chip-static">{countLabel}</span>
            <div className="pbm-status" ref={statusRef}>
              <button
                className="pbm-status-btn"
                style={{ color: st.fg }}
                onClick={() => setStatusMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={statusMenuOpen}
                aria-label={`Change status (currently ${st.label})`}
              >
                <span className="pbm-status-dot" style={{ background: st.dot }} />
                {st.label}
                <Icon name="chevronDown" size={13} strokeWidth={2} />
              </button>
              {statusMenuOpen && (
                <div className="pbm-menu pbm-menu--status" role="menu">
                  {STATUS_ORDER.map((k) => {
                    const meta = STATUS_META[k];
                    return (
                      <button
                        key={k}
                        role="menuitem"
                        className="pbm-menu-item"
                        onClick={() => changeStatus(k)}
                      >
                        <span
                          className="pbm-status-dot"
                          style={{ background: meta.dot }}
                        />
                        {meta.label}
                        {status === k && <span className="pbm-menu-check">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <span className="pbm-chip-static pbm-chip-static--src">{src.label}</span>
          </div>
          <LabelPicker
            ticketId={ticket.id}
            labels={labels}
            allLabels={allLabels}
          />
        </div>

        <div className="pbm-transcript pb-scroll">
          {hasOlderMessages && (
            <p className="pbm-transcript-note">
              Showing the latest {messages.length} messages — older history is
              retained but not displayed.
            </p>
          )}
          {ticket.source === "order" && ticket.orderId && (
            <p className="pbm-transcript-note">
              Linked order <b>{ticket.orderId}</b>
            </p>
          )}
          {messages.length === 0 && (
            <p className="pbm-transcript-note">
              This ticket has no messages yet.
            </p>
          )}
          {messages.map((m) => {
            const out = m.direction === "outbound";
            return (
              <div key={m.id} className="pbm-bubble-row" data-out={out || undefined}>
                <div className="pbm-bubble-wrap">
                  <div className="pbm-bubble">{m.body}</div>
                  {/* The design's "Delivered" is now a claim we can back: the
                      Resend webhook advances delivery_status. It is still only
                      ever what the provider told us, so this falls back to
                      "Sent" when nothing has come back yet rather than
                      assuming the better outcome. */}
                  <p
                    className="pbm-bubble-foot"
                    data-delivery={out ? (m.deliveryStatus ?? undefined) : undefined}
                    suppressHydrationWarning
                  >
                    {formatDateTime(m.sentAtIso)}
                    {out
                      ? ` · ${describeDeliveryStatus(m.deliveryStatus) ?? "Sent"}`
                      : ` · via ${src.label.toLowerCase()}`}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="pbm-composer-wrap">
          <div className="pbm-composer">
            <textarea
              ref={inputRef}
              className="pbm-composer-input"
              rows={1}
              value={replyText}
              aria-label="Write a reply"
              placeholder="Write a reply…  ⏎ to send"
              onChange={(e) => {
                setReplyText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
              }}
              onKeyDown={(e) => {
                // Enter sends, as the design asks. Shift+Enter still writes a
                // newline — support replies are not one-liners, and a
                // single-line <input> would have been a real downgrade.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendReply();
                }
              }}
            />
            <button
              className="pbm-icon-btn"
              disabled
              aria-label="Attach a file (not available yet)"
              title="Attachments aren't available yet."
            >
              <Icon name="clip" size={17} strokeWidth={1.8} />
            </button>
            <button
              className="pbm-send"
              onClick={() => void sendReply()}
              disabled={!canSend}
            >
              <span>{sending ? "Sending…" : "Send"}</span>
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M3.5 11.8L20 4.5l-7.3 16.5-2.2-6.6-7-2.6z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <p className="pbm-composer-foot" role={error ? "alert" : undefined}>
            {error ? (
              <span className="pbm-error">{error}</span>
            ) : (
              <>
                Sends a real email from <b>{fromAddress}</b>. Shift+Enter for a new
                line.
              </>
            )}
          </p>
        </div>
      </section>

      {/* Always rendered; mail.css decides whether "auto" means shown. */}
      <ContactRail
        contact={contact}
        state={rail}
        onClose={() => setRail("closed")}
        notes={notes}
        addNote={addNote}
        deleteNote={deleteNote}
        links={links}
      />
    </>
  );
}
