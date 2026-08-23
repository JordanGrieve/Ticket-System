import Link from "next/link";
import type { SharedLink } from "@/lib/shared-links";
import { MAX_SHARED_LINKS, sharedLinksTruncated } from "@/lib/shared-links";

/**
 * Links found in this contact's messages.
 *
 * ── THESE URLS WERE TYPED BY A STRANGER ──
 * They arrived through a public contact form and are being shown to the
 * business owner as things to click. That shapes every decision here:
 *
 *  - The HOSTNAME is the label. Not the link text from the message, not a
 *    title fetched from the page — the host it actually goes to. A link
 *    captioned "your invoice" pointing somewhere else is the oldest trick
 *    there is, and the only defence that survives it is showing where the
 *    thing goes.
 *  - rel="noopener noreferrer", so the opened page cannot reach back through
 *    window.opener, and our URL is not handed to it as a referrer.
 *  - NOTHING IS FETCHED. No preview, no favicon, no title, no unfurl. Fetching
 *    a stranger-supplied URL from the server is SSRF: they would be choosing
 *    what our server requests, from inside our network, and a link to an
 *    internal address would be requested with our credentials and our routing.
 *    Not a hypothetical — it is the standard way link previews get exploited.
 *
 * A server component: it only renders, and lib/shared-links.ts derives the
 * list from message bodies at read time.
 */
export default function SharedLinks({ links }: { links: SharedLink[] }) {
  return (
    <>
      <h3 className="pbm-rail-title pbm-rail-title--sub">Shared links</h3>

      {links.length === 0 ? (
        <p className="pbm-rail-void">
          No links in this conversation yet. Anything either of you sends will
          appear here.
        </p>
      ) : (
        <>
          <ul className="pbl-list">
            {links.map((link) => (
              <li className="pbl-item" key={link.url}>
                <a
                  className="pbl-link"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.url}
                >
                  <span className="pbl-host">{link.hostname}</span>
                  <span className="pbl-url">{link.url}</span>
                </a>
                <p className="pbl-meta">
                  {link.fromCustomer ? "They sent this" : "We sent this"}
                  <span aria-hidden> · </span>
                  <Link className="pbl-jump" href={`/tickets/${link.ticketId}`}>
                    Open the message
                  </Link>
                </p>
              </li>
            ))}
          </ul>

          {/*
            Said out loud rather than silently cut. A list that stops at twenty
            without comment looks exactly like a complete list of twenty.
          */}
          {sharedLinksTruncated(links) && (
            <p className="pbm-rail-void">
              Showing the {MAX_SHARED_LINKS} most recent. There are older ones
              in the conversation.
            </p>
          )}
        </>
      )}
    </>
  );
}
