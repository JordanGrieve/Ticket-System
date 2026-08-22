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
  const [rotating, setRotating] = useState(false);

  async function rotateKey() {
    const sure = window.confirm(
      "Rotate the API key?\n\nThe current key stops working immediately — any form using it will fail until you update the snippet on your site. Continue?",
    );
    if (!sure || rotating) return;
    setRotating(true);
    const res = await fetch("/api/workspace/rotate-key", { method: "POST" });
    setRotating(false);
    if (res.ok) router.refresh();
    else window.alert("Couldn't rotate the key — please try again.");
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
          <p className="sti-help">
            Collect subscribers for your newsletter. Every signup is confirmed by
            email before it is added — nobody joins the list until they click the
            link, so the addresses you collect are real and the consent is
            evidenced.
          </p>

          <h3 className="sti-sub-title">Paste this form on your site</h3>
          <p className="sti-help sti-help--tight">
            Plain HTML, no JavaScript needed. Style it however you like, but keep
            the field names — and the two anti-spam fields — exactly as they are.
            After submitting, the visitor is shown a hosted &ldquo;check your
            email&rdquo; page.
          </p>
          <CodeBlock code={newsletterSnippet} />

          <div className="sti-divider" />

          <h3 className="sti-sub-title">Or just link to the hosted page</h3>
          <p className="sti-help sti-help--tight">
            No code at all: point a button, a link in your footer or a social bio
            at this address and we host the signup form for you.
          </p>
          <Field value={hostedSignupUrl} copyLabel="Copy link" mono />
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
          <button className="sti-danger" onClick={rotateKey} disabled={rotating}>
            {rotating ? "Rotating…" : "Rotate key… (old snippets stop working)"}
          </button>

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
