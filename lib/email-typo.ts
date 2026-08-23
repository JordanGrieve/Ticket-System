/**
 * Addresses that are almost certainly a typo.
 *
 * Pure: no network, no DNS, no clock.
 *
 * ── WHY THIS IS A DENYLIST AND NOT A TLD ALLOWLIST ──
 * The obvious implementation is "check the TLD against the IANA list". It is
 * the wrong shape here. That list gains entries, this codebase would not, and
 * a stale allowlist REJECTS A VALID ADDRESS — silently, on a public signup form
 * that deliberately gives no feedback (see the no-oracle note on
 * app/api/subscribe/[key]/route.ts). Losing a real subscriber to a TLD nobody
 * updated is a worse failure than accepting a typo, and it is invisible.
 *
 * So this only ever fires on things that cannot be right: a small list of
 * high-confidence slips, each one a keystroke away from a real TLD or a real
 * provider. Anything not on the list passes. It is not a validator and cannot
 * be used as one — it answers "is this obviously wrong?", never "is this
 * right?".
 *
 * ── WHAT PROMPTED IT ──
 * A test submission entered `…@gmail.comf` on 22 August 2026 and Postbox
 * accepted it, correctly: `.comf` is syntactically legal and no regex knows it
 * is not a TLD. That address is now a contact, and every reply the bakery ever
 * sends it will bounce with nobody the wiser.
 *
 * ── WHY IT DOES NOT REJECT ANYTHING ──
 * Nothing here refuses a submission. An enquiry is somebody's actual customer
 * getting in touch, and losing one over a mistyped return address is far worse
 * than a bounce — the message still has a name, a question, and often a phone
 * number in it. It is surfaced to the business instead, next to the contact,
 * where a human can act on it.
 */

export type EmailTypo = {
  /** What is wrong, in the client's terms. */
  reason: string;
  /** The address this was probably meant to be, if it can be guessed. */
  suggestion: string | null;
};

/**
 * TLD slips: a real TLD with a neighbouring key added, or two swapped.
 *
 * Every entry maps to what it was almost certainly meant to be, and every one
 * is a string nobody could plausibly own — `.comf` and `.con` are not
 * delegated and are not going to be.
 */
const TLD_SLIPS: Record<string, string> = {
  comf: "com",
  comm: "com",
  con: "com",
  cim: "com",
  cpm: "com",
  cmo: "com",
  ocm: "com",
  "co,": "com",
  nett: "net",
  ner: "net",
  orgg: "org",
  ogr: "org",
  co_uk: "co.uk",
  "cok.uk": "co.uk",
  "co.ku": "co.uk",
};

/**
 * Provider slips, checked on the whole domain rather than the TLD.
 *
 * Only the handful that account for most real-world mistyping, and only where
 * the wrong form is not itself a live mail domain.
 */
const DOMAIN_SLIPS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "iclould.com": "icloud.com",
};

/** The domain part, lower-cased and trimmed. Null when there isn't one. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Is this address obviously mistyped?
 *
 * Returns null for anything it is not sure about, which is nearly everything.
 * A null is NOT a statement that the address is deliverable.
 */
export function detectEmailTypo(email: string): EmailTypo | null {
  const address = email.trim().toLowerCase();
  const domain = domainOf(address);
  if (!domain) return null;

  const local = address.slice(0, address.lastIndexOf("@"));

  const providerFix = DOMAIN_SLIPS[domain];
  if (providerFix) {
    return {
      reason: `“${domain}” looks like a misspelling of “${providerFix}”.`,
      suggestion: `${local}@${providerFix}`,
    };
  }

  const dot = domain.lastIndexOf(".");
  if (dot < 0) return null;
  const tld = domain.slice(dot + 1);

  const tldFix = TLD_SLIPS[tld];
  if (tldFix) {
    const stem = domain.slice(0, dot);
    return {
      reason: `“.${tld}” is not a real domain ending — it looks like “.${tldFix}”.`,
      suggestion: `${local}@${stem}.${tldFix}`,
    };
  }

  return null;
}

/**
 * What to show beside a contact whose address looks wrong.
 *
 * Phrased as an observation the reader can act on, not an accusation: the
 * customer typed it, the business is the one who has to live with it, and the
 * fix is usually to ring them.
 */
export function describeEmailTypo(typo: EmailTypo): string {
  const fix = typo.suggestion ? ` Did they mean ${typo.suggestion}?` : "";
  return `Replies to this address will not arrive. ${typo.reason}${fix}`;
}
