"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "./CopyButton";

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
  const [mode, setMode] = useState<"a" | "b" | "ai">("b");
  // The newsletter section has its own toggle. Separate state from the contact
  // form above on purpose: they are different jobs and a client who has already
  // wired up one should not have the other silently switch tab underneath them.
  const [nlMode, setNlMode] = useState<"form" | "ai" | "link">("form");
  const [rotating, setRotating] = useState(false);
  /** The rotate control has become its own "are you sure?". */
  const [confirming, setConfirming] = useState(false);
  /** Replaces window.alert. Null when there is nothing to say. */
  const [rotateError, setRotateError] = useState<string | null>(null);

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
    setConfirming(false);
    setRotateError(null);
    setRotating(true);
    try {
      const res = await fetch("/api/workspace/rotate-key", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setRotateError(
        "Couldn't rotate the key — nothing has changed, so your forms are still working. Try again in a moment.",
      );
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

  const snippetB = `<script>
(function () {
  // Point this at your existing contact form.
  var form = document.querySelector("#contact-form");
  if (!form) return;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = new FormData(form);
    try {
      var res = await fetch("${endpoint}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.get("name"),
          email: f.get("email"),
          message: f.get("message"),
          subject: f.get("subject") // optional
        })
      });
      if (res.ok) {
        form.reset();
        alert("Thanks — we got your message!");
      } else {
        alert("Sorry, something went wrong. Please try again.");
      }
    } catch (err) {
      alert("Sorry, something went wrong. Please try again.");
    }
  });
})();
</script>`;

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

## Your task
1. Find the site's existing contact form. If there is none, create a simple one
   with name, email and message fields that matches the site's styling.
2. Map the form's actual input names to the API fields above (e.g. an input named
   "full_name" maps to "name").
3. On submit: prevent the default navigation, disable the submit button while
   sending (no double submissions), POST the fields to the endpoint as JSON, then
   show a clear inline success message (e.g. "Thanks — we got your message!")
   without leaving the page. On failure, show a friendly error and re-enable the
   button.
4. Keep the site's existing markup, styling and behaviour intact everywhere else.
5. Fallback for plain-HTML sites with no JavaScript: instead of step 3, set the
   form's action="${endpoint}" and method="POST" — Postbox then shows a hosted
   confirmation page to the visitor.
6. After integrating, submit one test message ("Integration test — please ignore")
   and confirm the request returns HTTP 201.`;

  const snippet = mode === "a" ? snippetA : mode === "ai" ? snippetAI : snippetB;

  const newsletterSnippet = buildNewsletterSnippet(
    subscribeEndpoint,
    honeypotFields,
  );

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

        {/* ── Connect your form ── */}
        <Section title="1 · Connect your contact form">
          <div className="sti-modes">
            <Toggle active={mode === "b"} onClick={() => setMode("b")}>
              JavaScript (recommended)
            </Toggle>
            <Toggle active={mode === "a"} onClick={() => setMode("a")}>
              Point form at URL
            </Toggle>
            <Toggle active={mode === "ai"} onClick={() => setMode("ai")}>
              ✨ AI prompt
            </Toggle>
          </div>
          <p className="sti-help">
            {mode === "b"
              ? "Drop this before </body>. It intercepts your form so visitors stay on the page and see a success message — no redirect."
              : mode === "a"
                ? "The simplest option: set your form's action to this endpoint. On submit, the visitor sees a tidy confirmation page."
                : "Building your site with Claude, ChatGPT, Cursor or another AI assistant? Paste this prompt — it contains your endpoint and everything the AI needs to wire up your form correctly."}
          </p>
          <CodeBlock code={snippet} />
        </Section>

        {/* ── Newsletter signup ──
            Kept apart from the contact form above on purpose: one opens a
            ticket, the other asks a stranger for permission to email them
            later. They share the workspace key and nothing else. */}
        <Section title="2 · Add a newsletter signup">
          <div className="sti-modes">
            <Toggle active={nlMode === "form"} onClick={() => setNlMode("form")}>
              Paste a form
            </Toggle>
            <Toggle active={nlMode === "ai"} onClick={() => setNlMode("ai")}>
              ✨ AI prompt
            </Toggle>
            <Toggle active={nlMode === "link"} onClick={() => setNlMode("link")}>
              Just a link
            </Toggle>
          </div>

          <p className="sti-help">
            Collect subscribers for your newsletter. Every signup is confirmed by
            email before it is added — nobody joins the list until they click the
            link, so the addresses you collect are real and the consent is
            evidenced.
          </p>

          {nlMode === "form" && (
            <>
              <h3 className="sti-sub-title">Paste this form on your site</h3>
              <p className="sti-help sti-help--tight">
                Plain HTML, no JavaScript needed. Style it however you like, but
                keep the field names — and the two anti-spam fields — exactly as
                they are. After submitting, the visitor is shown a hosted
                &ldquo;check your email&rdquo; page.
              </p>
              <CodeBlock code={newsletterSnippet} />
            </>
          )}

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
              <CodeBlock code={newsletterAiPrompt} />
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
              <Field value={hostedSignupUrl} copyLabel="Copy link" mono />
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
          <Field value={inboundEmail} copyLabel="Copy address" mono />
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
          <Field value={apiKey} copyLabel="Copy key" mono />
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
                  onClick={() => setConfirming(false)}
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

          <div className="sti-gap" />
          <Label>Replies send from</Label>
          <p className="sti-help sti-help--tight">
            Your replies are delivered from this address, with your business name
            shown as the sender.
          </p>
          <Field value={replyFrom} copyLabel="Copy address" mono />

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

/**
 * The hosted-signup form a client pastes into their own page.
 *
 * `fields` is HONEYPOT_FIELDS, threaded down from lib/subscribe.ts rather than
 * written out here: the endpoint discards a submission whose trap fields arrive
 * non-empty, so a snippet naming the wrong fields is a form that silently stops
 * working the day the list changes.
 *
 * The traps are NOT `type="hidden"`. A form-filling bot populates a hidden
 * input exactly as happily as a visible one, and a real person never sees
 * either — so `hidden` costs the same and catches nothing. Off-screen plus
 * `tabindex="-1"` plus `aria-hidden` is invisible to eyes, to the keyboard and
 * to screen readers, while still looking like an ordinary text input to
 * anything parsing the markup.
 */
function buildNewsletterSnippet(
  endpoint: string,
  fields: readonly string[],
): string {
  const traps = fields
    .map(
      (name) =>
        `    <input name="${name}" type="text" tabindex="-1" autocomplete="off"\n` +
        `           style="position:absolute;left:-9999px" />`,
    )
    .join("\n");

  return `<form action="${endpoint}" method="POST">
  <label for="pb-signup-email">Email</label>
  <input id="pb-signup-email" name="email" type="email"
         placeholder="you@example.com" autocomplete="email" required />

  <label for="pb-signup-name">Name (optional)</label>
  <input id="pb-signup-name" name="name" type="text" autocomplete="name" />

  <button type="submit">Subscribe</button>

  <!-- Spam trap. Leave these empty and leave them exactly as they are:
       nobody sees them, and a bot that fills them in is discarded. -->
  <div aria-hidden="true">
${traps}
  </div>
</form>`;
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

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="sti-code">
      <div className="sti-code-copy">
        <CopyButton value={code} label="Copy snippet" compact />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Field({
  value,
  copyLabel,
  mono,
}: {
  value: string;
  copyLabel: string;
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
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="sti-mode"
      data-on={active}
      aria-pressed={active}
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
