/**
 * A link that opens the original message in the customer's own mail client.
 *
 * Pure, so the awkward cases can be pinned without a browser.
 *
 * ── THIS ONLY WORKS FOR SOME TICKETS, AND THAT IS NOT A BUG ──
 * Three things all have to be true, and each rules out a real population:
 *
 *  1. THE TICKET ARRIVED BY EMAIL. A contact-form submission never was an
 *     email — Postbox received an HTTP POST and made a thread out of it. There
 *     is no message sitting in anybody's mailbox to open, so for form tickets
 *     the honest answer is that the button should not exist.
 *
 *  2. WE CAPTURED THE RFC MESSAGE-ID. app/api/inbound/route.ts reads it from
 *     the payload or the headers, but it can be absent, and every message in
 *     the development database has a null one because the seed does not
 *     invent them. Without it there is nothing to search for.
 *
 *  3. THE MAIL IS STILL IN THEIR MAILBOX. Postbox exists so a business can
 *     stop working out of a shared Gmail account, and forwarding rules can be
 *     set to archive or delete the copy. So this can be present, correct, and
 *     still land on "no results" — which is a true statement about their
 *     mailbox rather than a failure of the link.
 *
 * Because of (3) the button is worded as a search rather than as a promise.
 */

/** Gmail wants the id without its angle brackets. */
function bareMessageId(messageId: string): string {
  return messageId.trim().replace(/^<|>$/g, "").trim();
}

/**
 * A Gmail search URL for one RFC 5322 Message-ID, or null when there is
 * nothing to link to.
 *
 * `rfc822msgid:` is Gmail's own search operator for exactly this, so the link
 * finds the message wherever it now lives — inbox, archive or a label — rather
 * than depending on a URL for a mailbox position that may have changed.
 *
 * ── /u/0 IS A GUESS, AND THE ONLY ONE AVAILABLE ──
 * It means "the first Google account signed in to this browser". Somebody
 * signed into a personal account first will land in the wrong mailbox and see
 * no results. Gmail offers no way to say "whichever account owns this address"
 * without already knowing which account that is, and we do not. The
 * alternative — omitting the index — behaves the same way with less
 * predictability, so this picks the common case and says so here.
 */
export function gmailSearchUrl(messageId: string | null): string | null {
  if (!messageId) return null;
  const bare = bareMessageId(messageId);
  if (!bare) return null;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(
    `rfc822msgid:${bare}`,
  )}`;
}

/**
 * Should a ticket offer the link at all?
 *
 * Only for mail that really was mail. `source` is checked as well as the id
 * because the two can disagree: a form ticket has no business offering to open
 * something in Gmail even in the odd case that a message id got attached to
 * it, and showing a control that reliably finds nothing teaches people to
 * distrust the ones that work.
 */
export function canOpenInMailClient(input: {
  source: string;
  messageId: string | null;
}): boolean {
  if (input.source === "contact_form") return false;
  return gmailSearchUrl(input.messageId) !== null;
}
