"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "./CopyButton";
import { highlight, type Language } from "../lib/highlight";

/**
 * The Install tab.
 *
 * The theme picker used to live at the bottom of this file under the label
 * "Accent". It moved to Settings → General (app/(dashboard)/settings/
 * ThemePicker.tsx) when that tab was built — it is a workspace preference, not
 * an installation step. It is NOT duplicated here.
 *
 * ── COLOUR ──
 * Nothing in this file paints a colour. Every rule is a .sti-* class in
 * app/settings.css reading tokens from globals.css, because six themes ride on
 * those tokens and this view used to ship literals: #fff cards on #efeadf
 * borders with #5f594f text, i.e. a cream card on a dark ground in five of the
 * six themes.
 *
 * ── WHY THE NEWSLETTER URLS ARE PROPS ──
 * The endpoint, the hosted link and the honeypot field names all come from
 * lib/subscribe.ts, which imports node:crypto. This is a Client Component, so
 * importing that module here would drag node:crypto into the browser bundle.
 * The page resolves them on the server and passes them down; see
 * app/(dashboard)/settings/install/page.tsx.
 */
export default function InstallView({
  apiKey,
  inboundEmail,
  replyFrom,
  workspaceName,
  appUrl,
  subscribeEndpoint,
  hostedSignupUrl,
  honeypotFields,
}: {
  apiKey: string;
  inboundEmail: string;
  /** The real address replies are sent from, e.g. `"Name" <replies@…>`. */
  replyFrom: string;
  workspaceName: string;
  appUrl: string;
  /** `POST {appUrl}/api/subscribe/{apiKey}` — built by the page from the key. */
  subscribeEndpoint: string;
  /** hostedSignupUrl() from lib/subscribe.ts, resolved on the server. */
  hostedSignupUrl: string;
  /** HONEYPOT_FIELDS from lib/subscribe.ts. Never hardcoded here. */
  honeypotFields: readonly string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"a" | "ai">("ai");
  // The newsletter section has its own toggle. Separate state from the contact
  // form above on purpose: they are different jobs and a client who has already
  // wired up one should not have the other silently switch tab underneath them.
  const [nlMode, setNlMode] = useState<"ai" | "link">("ai");
  const [rotating, setRotating] = useState(false);
  /** The rotate control has become its own "are you sure?". */
  const [confirming, setConfirming] = useState(false);
  /** Replaces window.alert. Null when there is nothing to say. */
  const [rotateError, setRotateError] = useState<string | null>(null);
  /**
   * Screen-reader narration for an outcome that is otherwise silent. A
   * successful rotation changes one string of characters in a field the
   * reader is not on; without this it happened without a word.
   */
  const [announcement, setAnnouncement] = useState("");
  const rotateBtnRef = useRef<HTMLButtonElement>(null);
  /** Set when the question closes by our hand, so focus follows it back. */
  const returnFocus = useRef(false);

  /*
    The three things a native confirm() gave for free and the in-page one has
    to spell out — the last of what was still missing after the dialog itself
    moved into the page (8 Sep 2026):

    Esc backs out. Scoped to while the question is open, so this page does not
    claim the key the rest of the time.
  */
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      returnFocus.current = true;
      setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  /*
    Focus goes back to the button. The question REPLACES it, so cancelling
    unmounts whatever the keyboard was standing on; without this, focus drops
    to <body> and the next Tab restarts from the top of the document.
  */
  useEffect(() => {
    if (confirming || !returnFocus.current) return;
    returnFocus.current = false;
    rotateBtnRef.current?.focus();
  }, [confirming]);

  /**
   * Rotating the key, with the question asked in the page rather than by the
   * browser.
   *
   * ── WHY NOT window.confirm ──
   * The same reasons components/mail/LabelManager.tsx sets out at length, and
   * they apply harder here: it is unstyleable and unthemeable across the six
   * themes, it cannot be asserted on in a test, and being modal to the whole
   * browser it steals focus out of whatever the person was doing.
   *
   * The one that matters most for THIS control is placement. A system dialog
   * puts the consequence somewhere other than the thing it applies to, and the
   * consequence here is severe and easy to under-read: every form on the
   * client's website stops working the moment the key changes, and stays
   * broken until somebody edits their site. That sentence belongs next to the
   * button, not in a grey box at the top of the screen.
   *
   * window.alert on the failure path had the same problem in reverse — the one
   * place an error message must not be is a modal the person dismisses before
   * they have read it.
   */
  async function rotateKey() {
    if (rotating) return;
    returnFocus.current = true;
    setConfirming(false);
    setRotateError(null);
    setAnnouncement("");
    setRotating(true);
    try {
      const res = await fetch("/api/workspace/rotate-key", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setAnnouncement("API key rotated. Update the snippet on your site with the new key.");
      router.refresh();
    } catch {
      setRotateError(
        "Couldn't rotate the key — nothing has changed, so your forms are still working. Try again in a moment.",
      );
      setAnnouncement("The key was not rotated. Your current key still works.");
    } finally {
      setRotating(false);
    }
  }

  const endpoint = `${appUrl}/api/tickets/${apiKey}`;

  const snippetA = `<form action="${endpoint}" method="POST">
  <input name="name" placeholder="Your name" required />
  <input name="email" type="email" placeholder="you@example.com" required />
  <textarea name="message" placeholder="How can we help?" required></textarea>
  <button type="submit">Send</button>
</form>`;

  const snippetAI = `You are helping integrate a website's contact form with Postbox, a support-ticket
inbox used by "${workspaceName}". When a visitor submits the contact form, the
submission must be POSTed to the Postbox API, which turns it into a support ticket.

## The API
Endpoint: POST ${endpoint}
Accepts JSON (Content-Type: application/json) or classic form-encoded submissions.

Fields:
- name    (string, required)  — the visitor's name
- email   (string, required)  — the visitor's email address
- message (string, required)  — the message body
- subject (string, optional)  — short subject line; if omitted, Postbox derives
  one from the message

Responses:
- Success:            HTTP 201, JSON {"ok": true, "ticket": {"id": 123, "status": "open"}}
- Validation failure: HTTP 400, JSON {"ok": false, "error": "human-readable reason"}
- Rate limited:       HTTP 429 (60 submissions/minute per workspace) — treat as a
  temporary failure and ask the visitor to try again shortly.
CORS is open, so the endpoint can be called directly from browser JavaScript.
The key inside the URL is a public ingestion key — safe to ship in client-side code.
Do not send any other secrets.

## Email intake (context — usually no code needed)
Besides the form, "${workspaceName}" receives support email. Their Postbox
inbound address is:

  ${inboundEmail}

Any email sent or forwarded to that address becomes a ticket automatically
(mentioning an order id like ORD-1234 or #4821 flags it as a priority order).
The business owner sets up forwarding from their real support inbox to that
address in their mail provider — that part is not a website change. For the
website: keep displaying the business's own public email address (do NOT put
the inbound address above on the site — it is a machine intake address, not a
human mailbox).

## The one rule that matters most
DO NOT CHANGE HOW THE SITE LOOKS. Not the form's markup, not its classes, not
its CSS, not its layout, not its copy. You are attaching behaviour to a form
that already exists and already looks the way its owner wants. Add no stylesheet
and no class of your own; if you must insert an element for the status message,
give it a class the site's own CSS can target and set no colours, spacing or
fonts on it yourself. A visibly different form after this change is a failed
integration, however well the submission works.

## Your task
1. FIND the form yourself — do not assume an id. Look at the actual page. Common
   shapes: Shopify renders {% form 'contact' %} as <form id="contact_form">
   (underscore) posting to /contact; WordPress Contact Form 7 renders
   <form class="wpcf7-form">; Elementor, Squarespace and hand-built sites all
   differ again. If a selector you pick could match nothing, the integration
   fails silently, which is worse than failing loudly — verify it matches on the
   real page before you rely on it.
2. Map the form's ACTUAL input names to the API fields above. They are usually
   not the same: Shopify posts contact[name], contact[email] and contact[body];
   Contact Form 7 posts your-name, your-email and your-message; Elementor posts
   form_fields[name]. Postbox understands those spellings, so you may simply
   forward every field the form has and let it work them out — that is the most
   robust option and needs no mapping at all.
3. On submit: prevent the default navigation, disable the submit button while
   sending (no double submissions), POST the fields to the endpoint as JSON, then
   show a clear inline success message without leaving the page. On failure, show
   a friendly error, re-enable the button, and DO NOT clear what the visitor
   typed — losing a written-out enquiry because the network blinked loses the
   customer too. On HTTP 429, tell them to try again in a minute rather than
   immediately.
4. Keep the site's existing markup, styling and behaviour intact everywhere else.
5. If the site has no contact form at all, create one — and match the site's own
   existing styles and class names rather than inventing a look for it.
6. Fallback for plain-HTML sites with no JavaScript: instead of step 3, set the
   form's action="${endpoint}" and method="POST". Postbox then shows a hosted
   confirmation page, so the visitor does leave the site — mention that to the
   owner rather than choosing it silently.
7. After integrating, submit one test message ("Integration test — please ignore")
   and confirm the request returns HTTP 201. If it returns 400, the field mapping
   is wrong: read the error, which names the fields that arrived empty.`;

  const snippet = mode === "a" ? snippetA : snippetAI;

  const newsletterAiPrompt = buildNewsletterAiPrompt(
    subscribeEndpoint,
    honeypotFields,
    workspaceName,
    hostedSignupUrl,
  );

  return (
    // The pane wrapper lives in the settings layout, shared with the other tabs.
    <div className="sti-wrap">
      <div className="sti-col">
        <h1 className="sti-title">Install &amp; settings</h1>
        <p className="sti-sub">
          Connect <b>{workspaceName}</b> to your website. Form submissions and
          forwarded email flow straight into this inbox.
        </p>

        {/*
          ── Connect your form ──

          TWO modes, and the pasteable JavaScript one is deliberately gone.

          It hardcoded `document.querySelector("#contact-form")` and opened with
          `if (!form) return;`, so on any site whose form is called anything
          else — which is most of them; Shopify's is `contact_form`, with an
          underscore — it did precisely nothing. No error, no console warning,
          no clue: the form carried on submitting to wherever it always had, and
          the client had no way to tell a broken install from a quiet week.

          No selector can be right for every site, so the answer is not a better
          guess. It is to let something that can SEE the page do the wiring: the
          AI prompt below says find the form you already have, map its real
          field names, and keep its markup, classes and styling exactly as they
          are. Jordan's call, 14 Sep 2026 — "we should never do our own
          styling".

          The no-JavaScript mode stays because the prompt assumes an assistant,
          and a client who has never opened one still has to be able to install
          this without hiring somebody. It touches nothing on their page at all;
          its one cost is the confirmation page, which the label now states
          outright instead of calling it "tidy".
        */}
        <Section title="1 · Connect your contact form">
          <div className="sti-modes">
            <Toggle
              active={mode === "ai"}
              onClick={() => setMode("ai")}
              label="AI prompt (recommended) — for your contact form"
            >
              ✨ AI prompt (recommended)
            </Toggle>
            <Toggle
              active={mode === "a"}
              onClick={() => setMode("a")}
              label="No code — point your contact form at Postbox"
            >
              No code
            </Toggle>
          </div>
          <p className="sti-help">
            {mode === "ai"
              ? "Paste this into Claude, ChatGPT, Cursor or whatever built your site. It carries your endpoint and tells the assistant to wire up the form you already have — keeping your own markup, classes and styling exactly as they are."
              : "No JavaScript, nothing to install: point your form's action at this endpoint. Your page is untouched, but the visitor leaves it — they land on a Postbox confirmation page after pressing send."}
          </p>
          <CodeBlock
            code={snippet}
            name={mode === "ai" ? "the contact form prompt" : "the contact form snippet"}
            language={mode === "ai" ? "prompt" : "html"}
            collapsible={mode === "ai"}
          />
        </Section>

        {/* ── Newsletter signup ──
            Kept apart from the contact form above on purpose: one opens a
            ticket, the other asks a stranger for permission to email them
            later. They share the workspace key and nothing else. */}
        <Section title="2 · Add a newsletter signup">
          <div className="sti-modes">
            <Toggle
              active={nlMode === "ai"}
              onClick={() => setNlMode("ai")}
              label="AI prompt (recommended) — for your newsletter signup"
            >
              ✨ AI prompt (recommended)
            </Toggle>
            <Toggle
              active={nlMode === "link"}
              onClick={() => setNlMode("link")}
              label="Just a link — send people to a signup page we host"
            >
              Just a link
            </Toggle>
          </div>

          <p className="sti-help">
            Collect subscribers for your newsletter. Every signup is confirmed by
            email before it is added — nobody joins the list until they click the
            link, so the addresses you collect are real and the consent is
            evidenced.
          </p>

          {nlMode === "ai" && (
            <>
              <h3 className="sti-sub-title">
                Already have a signup box? Point your AI at it
              </h3>
              <p className="sti-help sti-help--tight">
                If your site already has a &ldquo;subscribe to our newsletter&rdquo;
                section, this is the one to use. Paste it into Claude, ChatGPT,
                Cursor or whatever you build with. It finds the form you already
                have and connects it, keeping your design exactly as it is —
                rather than dropping a plain grey form into the middle of your
                page. It also tells the assistant the one thing it would
                otherwise get wrong: not to say &ldquo;you&rsquo;re
                subscribed&rdquo; when the confirmation email has only just been
                sent.
              </p>
              <CodeBlock
                code={newsletterAiPrompt}
                name="the newsletter prompt"
                collapsible
              />
            </>
          )}

          {nlMode === "link" && (
            <>
              <h3 className="sti-sub-title">Or just link to the hosted page</h3>
              <p className="sti-help sti-help--tight">
                No code at all, and nothing to change on your website. Point a
                button, a link in your footer, a social bio or a QR code at this
                address and we host the signup form for you.
              </p>
              <Field
                value={hostedSignupUrl}
                copyLabel="Copy link"
                copyOf="your hosted newsletter signup page"
                mono
              />
            </>
          )}
        </Section>

        {/* ── Inbound email ── */}
        <Section title="3 · Forward your email here">
          <p className="sti-help">
            Set up forwarding from your support inbox to the address below.
            Emails become tickets automatically; anything mentioning an order id
            (like <code className="sti-inline-code">ORD-1234</code> or{" "}
            <code className="sti-inline-code">#4821</code>) is flagged as a
            higher-priority order.
          </p>
          <Field
            value={inboundEmail}
            copyLabel="Copy address"
            copyOf="your inbound intake address"
            mono
          />
        </Section>

        {/* ── Steps ── */}
        <Section title="4 · You're done">
          <ol className="sti-steps">
            <Step n={1}>
              Paste the snippet above onto your site (or point your form at the
              URL).
            </Step>
            <Step n={2}>
              Add email forwarding from your inbox to <b>{inboundEmail}</b>.
            </Step>
            <Step n={3}>
              Reply to tickets from here — your replies send as real email from{" "}
              <b>{replyFrom}</b>, and customer responses thread right back.
            </Step>
          </ol>
        </Section>

        {/* ── Settings ── */}
        <Section title="Settings">
          <Label>Workspace API key</Label>
          <Field
            value={apiKey}
            copyLabel="Copy key"
            copyOf="your workspace API key"
            mono
          />
          {confirming ? (
            /* The control becomes the question, so the consequence sits beside
               the thing it applies to. Same shape as LabelManager's delete
               row. */
            <div
              className="sti-confirm"
              role="alertdialog"
              aria-label="Rotate the API key"
              aria-describedby="sti-confirm-q"
            >
              <p className="sti-confirm-q" id="sti-confirm-q">
                Rotate the API key? The current key stops working{" "}
                <b>immediately</b> — every form on your site using it will fail
                until you paste the new snippet in. There is no undo.
              </p>
              <div className="sti-confirm-acts">
                {/*
                  Cancel first and autofocused. The button that was under the
                  pointer a moment ago has just been replaced, so whatever the
                  keyboard was on has unmounted; focus has to go somewhere, and
                  the safe choice is the one that changes nothing.
                */}
                <button
                  type="button"
                  className="sti-confirm-btn"
                  autoFocus
                  onClick={() => {
                    returnFocus.current = true;
                    setConfirming(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="sti-confirm-btn sti-confirm-btn--danger"
                  onClick={rotateKey}
                >
                  Rotate the key
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={rotateBtnRef}
              type="button"
              className="sti-danger"
              onClick={() => {
                setRotateError(null);
                setConfirming(true);
              }}
              disabled={rotating}
            >
              {rotating ? "Rotating…" : "Rotate key… (old snippets stop working)"}
            </button>
          )}

          {rotateError && (
            <p className="sti-rotate-error" role="alert">
              {rotateError}
            </p>
          )}

          {/* Always mounted, empty until there is something to say: a live
              region added at the same moment as its text is routinely missed. */}
          <p className="stg-sr-only" role="status" aria-live="polite">
            {announcement}
          </p>

          <div className="sti-gap" />
          <Label>Replies send from</Label>
          <p className="sti-help sti-help--tight">
            Your replies are delivered from this address, with your business name
            shown as the sender.
          </p>
          <Field
            value={replyFrom}
            copyLabel="Copy address"
            copyOf="the address your replies are sent from"
            mono
          />

          <div className="sti-gap--lg" />
          <Label>Your data</Label>
          <p className="sti-help sti-help--tight">
            Download every ticket, message and contact in this workspace as a
            JSON file. It contains your customers&rsquo; personal data, so keep
            it somewhere safe.
          </p>
          <a className="sti-download" href="/api/workspace/export" download>
            Download my data
          </a>
        </Section>
      </div>
    </div>
  );
}

/**
 * The AI-assistant prompt for the newsletter form.
 *
 * Separate from the contact-form prompt above, and deliberately more insistent,
 * because the failure mode is worse. A contact form that is wired up wrongly
 * loses a message and somebody notices. A signup form that is wired up wrongly
 * tells a stranger "you're subscribed!" when nothing of the sort has happened —
 * they never confirm, they never hear from the business again, and nobody finds
 * out until someone asks why the list stopped growing.
 *
 * So the wording rules are stated as rules rather than left to the assistant's
 * judgement. Most models, told only "POST the email here", will write a cheerful
 * "You're on the list!" because that is what a signup form usually says. Here it
 * is a lie: the subscriber does not exist until the link in the email is pressed.
 *
 * The honeypot names are INTERPOLATED, never written into this string. They come
 * from HONEYPOT_FIELDS via the page, so changing the trap names in one place
 * changes them everywhere including in prompts already pasted into a chat.
 */
function buildNewsletterAiPrompt(
  endpoint: string,
  fields: readonly string[],
  workspaceName: string,
  hostedUrl: string,
): string {
  const traps = fields
    .map(
      (name) =>
        `  <input name="${name}" type="text" tabindex="-1" autocomplete="off"\n` +
        `         style="position:absolute;left:-9999px" />`,
    )
    .join("\n");

  const trapList = fields.map((f) => `"${f}"`).join(" and ");

  return `You are wiring up an existing newsletter signup form on a website so that
subscribers are collected by Postbox, the email platform used by "${workspaceName}".

The site almost certainly ALREADY has a signup section — a heading, a line of
copy, an email input and a Subscribe button. Your job is to connect what is
already there. Do not redesign it, do not restyle it, and do not replace it with
a form of your own. Keep the existing markup, classes and styling exactly as they
are and change only what has to change to make it submit to Postbox.

## The endpoint

POST ${endpoint}

Fields:
- email (string, REQUIRED) — the subscriber's address
- name  (string, optional) — their name, if the existing form asks for one

Accepts either a normal form-encoded POST or JSON (Content-Type: application/json).
CORS is open, so browser JavaScript can call it directly. The key in the URL is a
public ingestion key and is safe in client-side source. Do not add any other
secret, token or API key to the page.

## Anti-spam fields — copy these in exactly

Add these to the form, unchanged. They are invisible to people and to screen
readers; a bot that fills one in is silently discarded.

<div aria-hidden="true">
${traps}
</div>

Do not rename them, do not remove the inline style, and do not add labels or
placeholders to them. If the form already contains inputs named ${trapList},
leave those alone rather than adding a second copy.

## HOW THIS WORKS, AND THE WORDING RULES THAT FOLLOW FROM IT

Postbox uses confirmed opt-in. Submitting the form does NOT subscribe anybody.
It sends them an email containing a confirmation link, and the subscription is
created only when they press it. Nothing is stored until then.

This changes what the page is allowed to say, and it is the part most likely to
be got wrong:

- DO say, after a successful submit, something like
  "Almost there — check your email for a link to confirm."
- DO NOT say "You're subscribed", "You're on the list", "Welcome aboard",
  "Thanks for subscribing", or anything else that claims the signup is complete.
  It is not complete, and telling them it is means they will not go and press
  the link.
- If the existing form already shows a success message of the wrong kind, change
  the wording. This is the one piece of visible copy you SHOULD edit.
- Near the input, it is worth saying plainly that a confirmation email is coming.
  Adjust the existing supporting copy if it promises instant signup.

## Two ways to connect it — pick ONE

Option 1, no JavaScript (simplest, and fine for a static site):
Set the form's action to the endpoint and its method to POST:

  <form action="${endpoint}" method="POST">

On submit the visitor is taken to a hosted "check your email" page. You do not
need to write a success message at all in this case — the hosted page handles it.

Option 2, JavaScript (keeps the visitor on the page):
Intercept the submit, POST the fields as JSON, and show an inline message. While
the request is in flight, disable the submit button so the form cannot be sent
twice. Then show the "check your email" wording described above.

## Responses

- 202 Accepted — {"ok": true, ...}. Show the "check your email" message.
- 400 Bad Request — {"ok": false, "error": "..."}. Usually a malformed address.
  Show a short inline error and let them correct it.
- 429 Too Many Requests — too many signups too quickly. Ask them to try again in
  a minute. Do not retry automatically in a loop.
- 503 Service Unavailable — the platform is not configured to accept signups yet.
  Show a neutral failure and do not lose the address the visitor typed.

Important: a successful response tells you the request was accepted. It does NOT
tell you whether the address was new, already subscribed, or previously
unsubscribed — Postbox deliberately answers identically in every case so that
nobody can use the form to test whether an address is on the list. Do not write
code that tries to distinguish these; there is nothing to distinguish.

## Things you do NOT need to do

- No DNS changes. Collecting subscribers needs nothing in the domain settings.
  (DNS records are only involved later, and only if the business wants newsletters
  to be sent from its own domain instead of the platform's. That is a separate
  job, done in Postbox, and it is not part of this task.)
- No backend, no database, no server code, no environment variables.
- No consent checkbox is required for this to work — the confirmation email is
  the consent record. Leave one in place if the site already has one.

## If there is no form on the site at all

Build a minimal one that matches the site's existing type, spacing and colours:
an email input, a Subscribe button, and the hidden fields above. Alternatively,
the business can skip code entirely and link to their hosted signup page:

  ${hostedUrl}

## When you are done

Submit one real address you can read, confirm the page shows the "check your
email" wording rather than a completed-signup message, and check that the
confirmation email arrives. Do not press the link if you are only testing the
form — pressing it creates a real subscriber.`;
}


function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sti-section">
      <h2 className="sti-section-title">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A snippet, shown short until somebody asks for the rest.
 *
 * ── WHY ──
 * Both install sections lead with an AI prompt now, and a prompt is seventy
 * lines of instructions written for a machine. Rendered in full it is the whole
 * screen: the steps around it, the newsletter section below it and the key
 * rotation at the bottom all get pushed off, and a client scrolls past a wall
 * of text they were never meant to read to reach the thing they were looking
 * for. Jordan, 14 Sep 2026 — "they don't need to be the full size, just do it a
 * third of the size unless they hit show more".
 *
 * ── THE TOGGLE ONLY APPEARS WHEN IT IS EARNED ──
 * Measured, not assumed. The contact section shows a six-line form in its
 * no-code mode and a seventy-line prompt in the other, through this same
 * component; a "Show more" under six lines that are already all visible is a
 * control that lies about there being something behind it. So the height is
 * compared against the content after layout, and the button is rendered only
 * if the thing genuinely overflows.
 *
 * ── COPY TAKES THE WHOLE THING ──
 * The copy button reads `code`, not the DOM, so a collapsed block still copies
 * every line. Worth stating because the obvious implementation — read the
 * rendered text — would silently hand somebody a third of a prompt, and it
 * would look like it worked.
 */
function CodeBlock({
  code,
  name,
  language = "prompt",
  collapsible = false,
}: {
  code: string;
  /**
   * Which grammar colours this block. See lib/highlight.ts.
   *
   * It returns kinds, not colours; the inks are --code-* tokens, measured at
   * 7:1 on --code-bg in tests/code-contrast.test.ts and different per theme.
   */
  language?: Language;
  /**
   * What this block holds, for the controls' accessible names — e.g. "the
   * contact form prompt".
   *
   * The page carries two of these, so without it there were two buttons named
   * "Copy snippet" and two named "Show more". Reads into a sentence: "Copy
   * snippet — the newsletter prompt", "Show more of the newsletter prompt".
   */
  name: string;
  /**
   * Whether this block may be clipped.
   *
   * Off by default, and opted into only by the two AI prompts. The cut is 92px
   * — three lines — which is right for a seventy-line document nobody reads and
   * wrong for the six-line form in the no-code mode: that one is meant to be
   * taken whole, and hiding half of it behind a button would be hiding the
   * thing itself.
   *
   * A height threshold was the alternative and it is the worse one. It would
   * make "is this collapsible" depend on how a snippet happens to wrap today,
   * so a form that grew one line would silently start hiding itself.
   */
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  /*
    Starts TRUE, which is the whole trick.

    The cap lives in the stylesheet, on `.is-clipped`. So a block that has not
    been clipped yet has no cap, its scrollHeight EQUALS its clientHeight, and
    "does this overflow?" is always no — the class can never be applied, and the
    measurement can never see the thing it exists to measure. Starting false
    shipped a page where every prompt stood at full height and no Show more
    appeared at all; the suite stayed green because the test stubbed the two
    heights to differ unconditionally, which is a state no browser produces.

    Clipped first, then measured: while the class is on, scrollHeight and
    clientHeight differ for real, so a SHORT snippet reports "fits" and this
    flips to false. It also means the long prompt never flashes at full height
    before collapsing.
  */
  const [overflows, setOverflows] = useState(true);
  const clipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = clipRef.current;
    /*
      Return without touching state. Setting `overflows` to false here would be
      a setState inside an effect (react-hooks/set-state-in-effect, and the rule
      is right — it is a value, not a side effect), so a stale `true` from a
      previous render is simply never READ: `clipped` below is gated on
      `collapsible` as well.
    */
    if (!collapsible || !el) return;
    // Compared while collapsed; expanding removes the cap, so measuring then
    // would always report "fits" and the button would vanish on first press.
    const check = () => {
      if (expanded) return;
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    // Re-measured on resize: the same prompt wraps differently at phone width,
    // and a block that overflows on a laptop may not on a wide screen.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [code, expanded, collapsible]);

  /* Derived, so a stale measurement from a collapsible block cannot leak into
     one that opted out. */
  const clipped = collapsible && overflows;

  return (
    <div className="sti-code">
      {/*
        Both controls in one row at the top right, the opener to the LEFT of
        Copy.

        It was a text button under the block, which put it at the bottom of a
        300px box — below the fold on a phone, and far from the only other
        control on the panel. Jordan, 14 Sep 2026: "add a button next to copy
        snippet on the left that says show more code."
      */}
      <div className="sti-code-copy">
        {clipped && (
          <button
            type="button"
            className="sti-code-more"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Show less" : "Show more"} code — ${name}`}
          >
            {expanded ? "Show less code" : "Show more code"}
          </button>
        )}
        <CopyButton
          value={code}
          label="Copy snippet"
          ariaLabel={`Copy snippet — ${name}`}
          compact
        />
      </div>
      {/*
        The clip is a wrapper, not the <pre> itself.

        The <pre> scrolls horizontally, and an absolutely positioned fade inside
        a horizontally scrolling box slides away sideways with the content. The
        wrapper does the vertical clipping and carries the fade; the <pre> keeps
        its own overflow-x and nothing moves.
      */}
      <div
        ref={clipRef}
        className={`sti-code-clip${!expanded && clipped ? " is-clipped" : ""}`}
      >
        <pre>
          {/*
            One span per run. The tokeniser is asserted to round-trip, so the
            text rendered here is the text the copy button sends — a client can
            trust that what they are looking at is what they are handing over.
          */}
          <code>
            {highlight(code, language).map((token, i) => (
              <span key={i} className={`hl-${token.kind}`}>
                {token.text}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

function Field({
  value,
  copyLabel,
  copyOf,
  mono,
}: {
  value: string;
  copyLabel: string;
  /**
   * What this field holds, for the copy button's accessible name.
   *
   * Two fields on this page use the label "Copy address" — the inbound intake
   * address and the address replies are sent from — and they are very different
   * things to paste somewhere. Appended after the visible words, never
   * replacing them (WCAG 2.5.3).
   */
  copyOf: string;
  mono?: boolean;
}) {
  return (
    <div className="sti-field">
      <div
        className={`sti-field-value${mono ? " sti-field-value--mono" : ""}`}
        title={value}
      >
        {value}
      </div>
      <CopyButton
        value={value}
        label={copyLabel}
        ariaLabel={`${copyLabel} — ${copyOf}`}
      />
    </div>
  );
}

/**
 * One mode toggle.
 *
 * ── WHY IT TAKES A LABEL ──
 *
 * This page has two sections offering the same two choices, so before 14 Sep
 * 2026 it rendered two buttons reading "✨ AI prompt (recommended)" and two
 * reading "No code". Sighted people tell them apart by the heading above each;
 * anyone listing the page's controls — a screen reader's control list, voice
 * control saying "click AI prompt" — got two identical names and no way to
 * choose.
 *
 * `label` is the accessible name and always NAMES THE SECTION. It must contain
 * the visible text word for word: WCAG 2.5.3 Label in Name, so that saying what
 * is written on the button still activates it. "AI prompt for your contact
 * form" contains "AI prompt"; "AI prompt · contact" would not.
 */
function Toggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** The accessible name. Must contain the visible text — see above. */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className="sti-mode"
      data-on={active}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="sti-step">
      <span className="sti-step-n" aria-hidden>
        {n}
      </span>
      <span className="sti-step-body">{children}</span>
    </li>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="sti-label">{children}</div>;
}
