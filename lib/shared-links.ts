/**
 * Links a customer has sent, pulled out of the messages they sent them in.
 *
 * Pure: no database, no network. Nothing here fetches a URL, and nothing here
 * ever should — see the SSRF note below.
 *
 * ── DERIVED, NOT STORED ──
 * Every link is already sitting in `ticket_messages.body`, which is plain text
 * rendered as plain text. This is extraction, not capture: no new table, no
 * write path, and nothing to backfill for messages that arrived before the
 * feature existed. If it turns out to be slow, measure before adding a table.
 */

export type SharedLink = {
  /** The absolute URL, http(s) only. */
  url: string;
  /**
   * The host, shown prominently in the UI.
   *
   * These URLs were typed by strangers into a public form and are being shown
   * to the business owner. A bare link text of "click here" pointing somewhere
   * else is the oldest trick there is, so the destination host is displayed as
   * the primary label rather than whatever the message called it.
   */
  hostname: string;
  /** The message it appeared in, so the UI can link back to context. */
  ticketId: number;
  /** ISO timestamp of that message. */
  atIso: string;
  /** Who sent it. A link from the customer is not the same as one we sent. */
  fromCustomer: boolean;
};

export type LinkSource = {
  ticketId: number;
  body: string;
  createdAtIso: string;
  /** "inbound" = from the customer. */
  direction: string;
};

/** Most a rail 290px wide can usefully show. */
export const MAX_SHARED_LINKS = 20;

/*
 * Scheme-anchored on purpose.
 *
 * A pattern that also matched bare "www.example.com" would be friendlier and
 * would be wrong: it turns any sentence mentioning a domain into a clickable
 * link, and it invites guessing a scheme. More importantly, matching ANY
 * scheme rather than http(s) would let `javascript:...` out of a message body
 * and into an href, which is script execution in the business owner's session,
 * typed by a stranger through a public contact form.
 *
 * So: http and https, nothing else, ever.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;

/*
 * Punctuation that is almost always the sentence, not the URL.
 *
 * "Have a look at https://example.com/page." should not link to "page." — the
 * trailing stop is English. Brackets are handled separately below because a
 * URL may legitimately contain balanced ones.
 */
const TRAILING_JUNK = /[.,;:!?'"]+$/;

/**
 * Trim what the sentence contributed, without damaging the URL.
 *
 * Wikipedia-style URLs really do end in ")", so a closing bracket is only
 * dropped when there is no matching opener inside the URL itself.
 */
export function trimUrlPunctuation(raw: string): string {
  let url = raw.replace(TRAILING_JUNK, "");

  while (url.endsWith(")") || url.endsWith("]")) {
    const close = url.slice(-1);
    const open = close === ")" ? "(" : "[";
    const opens = url.split(open).length - 1;
    const closes = url.split(close).length - 1;
    if (closes <= opens) break; // balanced — the bracket belongs to the URL
    url = url.slice(0, -1).replace(TRAILING_JUNK, "");
  }

  return url;
}

/**
 * Every http(s) link in these messages, newest first, one entry per URL.
 *
 * Deduplicated by exact URL and keeping the MOST RECENT occurrence: a customer
 * who resends the same tracking link four times should appear once, dated when
 * they last sent it, because that is the one somebody wants to open.
 */
export function extractSharedLinks(messages: LinkSource[]): SharedLink[] {
  const newestFirst = [...messages].sort(
    (a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso),
  );

  const seen = new Map<string, SharedLink>();

  for (const message of newestFirst) {
    for (const match of message.body.matchAll(URL_PATTERN)) {
      const url = trimUrlPunctuation(match[0]);

      let hostname: string;
      try {
        const parsed = new URL(url);
        // Belt and braces. The pattern is scheme-anchored, but a parsed
        // protocol is the thing an href actually acts on, so it is what gets
        // checked before anything is rendered as a link.
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          continue;
        }
        hostname = parsed.hostname;
      } catch {
        // Not a URL the platform can parse is not a URL we will render.
        continue;
      }

      if (!hostname || seen.has(url)) continue;

      seen.set(url, {
        url,
        hostname,
        ticketId: message.ticketId,
        atIso: message.createdAtIso,
        fromCustomer: message.direction === "inbound",
      });

      if (seen.size >= MAX_SHARED_LINKS) return [...seen.values()];
    }
  }

  return [...seen.values()];
}

/**
 * Whether the list was cut short.
 *
 * Said out loud in the UI rather than silently truncated: a list that quietly
 * stops at twenty looks like a complete list of twenty.
 */
export function sharedLinksTruncated(links: SharedLink[]): boolean {
  return links.length >= MAX_SHARED_LINKS;
}
