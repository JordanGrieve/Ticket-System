/**
 * Reading a contact form we did not write.
 *
 * Pure: no database, no environment, no request. The ingestion routes call it
 * and nothing else does.
 *
 * ── WHY THIS EXISTS ──
 *
 * Both public ingestion endpoints read `fields.name`, `fields.email` and
 * `fields.message` by their exact spellings, and almost nobody's form uses
 * them. The two biggest platforms a small business is actually on do not:
 *
 *   Shopify   {% form 'contact' %}  →  contact[name], contact[email], contact[body]
 *   WordPress Contact Form 7        →  your-name,     your-email,     your-message
 *   Elementor forms                 →  form_fields[name], form_fields[email], …
 *
 * So "point your form's action at this URL" — the simplest mode we offer, the
 * one a non-technical client picks — posted three empty strings from a Shopify
 * or WordPress site and got back "Missing required field(s)". Found on
 * 14 Sep 2026 while preparing a walkthrough on a real Shopify store,
 * byamoria.com, before a single enquiry had been sent.
 *
 * The fix belongs HERE, at the boundary, and not in the JavaScript snippet.
 * Fixing the snippet would have left the native-form mode broken, left every
 * hand-rolled integration broken, and left anything an AI assistant wires up
 * broken whenever it guessed the mapping wrong. Be liberal in what you accept,
 * once, where every caller passes.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──
 *
 * It does not guess from numbered fields. WPForms posts
 * `wpforms[fields][0]` and Gravity Forms posts `input_1`; the digits carry no
 * meaning and any mapping would be a coin toss on somebody's real enquiry.
 * Those need the JavaScript snippet or the AI prompt, and saying so is better
 * than a plausible-looking guess that files a phone number as a name.
 */

/** The four things a ticket is built from. */
export type ContactSubmission = {
  name: string;
  email: string;
  message: string;
  subject: string;
};

/**
 * Reduce a field name to the word inside it.
 *
 * `contact[name]` → `name`, `your-email` → `youremail`,
 * `form_fields[message]` → `message`, `Full Name` → `fullname`.
 *
 * The innermost bracket segment wins, because every platform that namespaces
 * its fields puts the meaningful word last: `contact[name]`,
 * `form_fields[email]`, `fields[body]`. Everything else is lower-cased and
 * stripped of punctuation so that `your-name`, `your_name` and `YourName` are
 * one key rather than three.
 */
export function normaliseFieldName(raw: string): string {
  const brackets = raw.match(/\[([^\]]*)\]/g);
  const inner = brackets
    ? brackets[brackets.length - 1].slice(1, -1)
    : raw;
  // An empty final segment means an array field like `tags[]`; fall back to
  // the part before the brackets so `contact[]` does not normalise to "".
  const chosen = inner.trim() === "" ? raw.split("[")[0] : inner;
  return chosen.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/*
 * Aliases, most specific first. Order is the whole contract: the first alias
 * present and non-empty wins, so the exact documented name always beats a
 * guess, and a form carrying both `email` and `contact[email]` resolves to the
 * one the API asks for.
 */
const EMAIL_ALIASES = [
  "email", "youremail", "emailaddress", "contactemail", "customeremail",
  "senderemail", "fromemail", "replyto", "emailaddr", "mail", "usermail",
];

const NAME_ALIASES = [
  "name", "yourname", "fullname", "contactname", "customername", "sendername",
  "fromname", "username", "authorname", "displayname",
];

const MESSAGE_ALIASES = [
  "message", "yourmessage", "body", "comments", "comment", "enquiry",
  "inquiry", "question", "details", "description", "content", "notes",
  "howcanwehelp",
];

const SUBJECT_ALIASES = [
  "subject", "yoursubject", "topic", "reason", "regarding", "title",
];

/** First name + last name, for the forms that split them. */
const FIRST_ALIASES = ["firstname", "fname", "givenname", "forename", "yourfirstname"];
const LAST_ALIASES = ["lastname", "lname", "surname", "familyname", "yourlastname"];

/**
 * Platform machinery that must never be mistaken for a person's words.
 *
 * `form_type` and `utf8` are Shopify's; `_wpnonce` and `_wp_http_referer` are
 * WordPress's. Be straight about what this does today: NONE of them matches an
 * alias above, so removing this set changes no current behaviour and no test
 * goes red. It is not a guard that fires — it is a fence for the next person
 * to widen an alias list, which is the change that would make one of these
 * suddenly readable as a name or a message. Kept for that, and described
 * honestly rather than dressed up as protection it is not providing.
 *
 * The assertion that DOES bite is in tests/submission-fields.test.ts: a
 * password and a CSRF token must never come out as content. That one fails the
 * moment somebody adds a loose alias, whether or not this set exists.
 */
const IGNORED = new Set([
  "formtype", "utf8", "wpnonce", "wphttpreferer", "grecaptcharesponse",
  "hcaptcharesponse", "cfturnstileresponse", "csrftoken", "authenticitytoken",
  "id", "action", "submit", "password", "tags", "checkout",
]);

/** Every field, keyed by its normalised name. Earlier keys win a collision. */
function index(fields: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [raw, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    const key = normaliseFieldName(raw);
    if (!key || IGNORED.has(key)) continue;
    // An exact match is worth more than a namespaced one, and Object.entries
    // gives insertion order, so only fill a key once.
    if (!out.has(key) || out.get(key)!.trim() === "") out.set(key, value);
  }
  return out;
}

function pick(map: Map<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const v = map.get(alias);
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

/**
 * Read a submission from whatever the form happened to call its fields.
 *
 * Returns raw strings — trimming, length caps and validation stay with the
 * caller, which already does all three and is where the honest 400 comes from.
 */
export function readContactSubmission(
  fields: Record<string, string>,
): ContactSubmission {
  const map = index(fields);

  let name = pick(map, NAME_ALIASES);
  if (!name) {
    // Split-name forms. Either half alone is still a usable name.
    const first = pick(map, FIRST_ALIASES);
    const last = pick(map, LAST_ALIASES);
    name = [first, last].filter((p) => p.trim() !== "").join(" ");
  }

  return {
    name,
    email: pick(map, EMAIL_ALIASES),
    message: pick(map, MESSAGE_ALIASES),
    subject: pick(map, SUBJECT_ALIASES),
  };
}

/** The newsletter signup asks for less, and reads it the same way. */
export function readSignupSubmission(
  fields: Record<string, string>,
): { email: string; name: string } {
  const map = index(fields);
  let name = pick(map, NAME_ALIASES);
  if (!name) {
    const first = pick(map, FIRST_ALIASES);
    const last = pick(map, LAST_ALIASES);
    name = [first, last].filter((p) => p.trim() !== "").join(" ");
  }
  return { email: pick(map, EMAIL_ALIASES), name };
}
