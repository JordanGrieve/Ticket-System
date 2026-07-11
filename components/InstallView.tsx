"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "./CopyButton";
import { ACCENT_SCHEMES } from "@/lib/theme";

export default function InstallView({
  apiKey,
  inboundEmail,
  replyFrom,
  workspaceName,
  accent,
  appUrl,
}: {
  apiKey: string;
  inboundEmail: string;
  /** The real address replies are sent from, e.g. `"Name" <replies@…>`. */
  replyFrom: string;
  workspaceName: string;
  accent: string;
  appUrl: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"a" | "b" | "ai">("b");

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

  async function pickAccent(key: string) {
    const res = await fetch("/api/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accent: key }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div style={{ height: "100vh", overflowY: "auto" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "34px 32px 64px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em", color: "var(--ink)" }}>
          Install &amp; settings
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted-2)", marginTop: 6, lineHeight: 1.6 }}>
          Connect <b style={{ color: "#5f594f", fontWeight: 600 }}>{workspaceName}</b> to your
          website. Form submissions and forwarded email flow straight into this inbox.
        </p>

        {/* ── Connect your form ── */}
        <Section title="1 · Connect your contact form">
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
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
          <p style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.6, marginBottom: 12 }}>
            {mode === "b"
              ? "Drop this before </body>. It intercepts your form so visitors stay on the page and see a success message — no redirect."
              : mode === "a"
                ? "The simplest option: set your form's action to this endpoint. On submit, the visitor sees a tidy confirmation page."
                : "Building your site with Claude, ChatGPT, Cursor or another AI assistant? Paste this prompt — it contains your endpoint and everything the AI needs to wire up your form correctly."}
          </p>
          <CodeBlock code={snippet} />
        </Section>

        {/* ── Inbound email ── */}
        <Section title="2 · Forward your email here">
          <p style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.6, marginBottom: 12 }}>
            Set up forwarding from your support inbox to the address below. Emails become
            tickets automatically; anything mentioning an order id (like{" "}
            <code style={inlineCode}>ORD-1234</code> or <code style={inlineCode}>#4821</code>) is
            flagged as a higher-priority order.
          </p>
          <Field value={inboundEmail} copyLabel="Copy address" mono />
        </Section>

        {/* ── Steps ── */}
        <Section title="3 · You're done">
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 12 }}>
            <Step n={1}>Paste the snippet above onto your site (or point your form at the URL).</Step>
            <Step n={2}>
              Add email forwarding from your inbox to{" "}
              <b style={{ color: "#5f594f" }}>{inboundEmail}</b>.
            </Step>
            <Step n={3}>
              Reply to tickets from here — your replies send as real email from{" "}
              <b style={{ color: "#5f594f" }}>{replyFrom}</b>, and customer responses thread
              right back.
            </Step>
          </ol>
        </Section>

        {/* ── Settings ── */}
        <Section title="Settings">
          <Label>Workspace API key</Label>
          <Field value={apiKey} copyLabel="Copy key" mono />

          <div style={{ height: 20 }} />
          <Label>Replies send from</Label>
          <p style={{ fontSize: 12.5, color: "var(--muted-2)", lineHeight: 1.6, margin: "0 0 8px" }}>
            Your replies are delivered from this address, with your business
            name shown as the sender.
          </p>
          <Field value={replyFrom} copyLabel="Copy address" mono />

          <div style={{ height: 24 }} />
          <Label>Accent</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
            {Object.entries(ACCENT_SCHEMES).map(([key, s]) => {
              const active = accent === key;
              return (
                <button
                  key={key}
                  onClick={() => pickAccent(key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "9px 12px",
                    borderRadius: 11,
                    cursor: "pointer",
                    background: "#fff",
                    border: `1.5px solid ${active ? s.accent : "var(--border)"}`,
                  }}
                >
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: s.accent }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "#3a3530" }}>{s.label}</span>
                  {active && <span style={{ color: s.accent, fontSize: 14 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginTop: 24,
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "22px 24px",
        boxShadow: "0 1px 0 rgba(60,50,35,.03)",
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 14 }}>{title}</h2>
      {children}
    </section>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div
      style={{
        position: "relative",
        background: "#2b2620",
        borderRadius: 12,
        border: "1px solid #3a342c",
      }}
    >
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1 }}>
        <CopyButton value={code} label="Copy snippet" compact />
      </div>
      <pre
        style={{
          margin: 0,
          padding: "16px 18px",
          overflowX: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          lineHeight: 1.7,
          color: "#e9e2d5",
          whiteSpace: "pre",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Field({ value, copyLabel, mono }: { value: string; copyLabel: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 42,
          padding: "0 14px",
          background: "var(--app-bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          flex: 1,
          minWidth: 0,
          fontFamily: mono ? "var(--font-mono)" : undefined,
          fontSize: 13.5,
          color: "var(--ink)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <CopyButton value={value} label={copyLabel} />
      </div>
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
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: 9,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        background: active ? "#26221d" : "#fff",
        color: active ? "#fff" : "#6b6255",
        border: `1px solid ${active ? "#26221d" : "var(--border)"}`,
      }}
    >
      {children}
    </button>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span
        style={{
          flex: "0 0 auto",
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "var(--accent-soft)",
          color: "var(--accent-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12.5,
          fontWeight: 700,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13.5, color: "#4a453d", lineHeight: 1.55, paddingTop: 2 }}>
        {children}
      </span>
    </li>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: "var(--muted-3)",
        letterSpacing: ".06em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

const inlineCode: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  background: "var(--order-bg)",
  color: "var(--order-fg)",
  padding: "1px 5px",
  borderRadius: 4,
};
