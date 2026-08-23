import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { PostboxLockup } from "@/components/Logo";

/**
 * Public landing page. Signed-in users go straight to their inbox;
 * prospects get the pitch. Postbox is invite-only, so the CTA is
 * "sign in" plus a contact nudge rather than open sign-up.
 */
export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/inbox");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--app-bg)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* nav */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: 980,
          width: "100%",
          margin: "0 auto",
          padding: "22px 24px",
        }}
      >
        <PostboxLockup />
        <Link
          href="/sign-in"
          style={{
            height: 38,
            padding: "0 18px",
            borderRadius: 10,
            // Was #fff against color: var(--ink) — which is a LIGHT ink on the
            // five dark themes, so the label vanished into the button.
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--ink)",
            fontSize: 13.5,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Sign in
        </Link>
      </header>

      {/* hero */}
      <main style={{ flex: 1 }}>
        <section
          style={{
            maxWidth: 780,
            margin: "0 auto",
            padding: "72px 24px 40px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 42,
              lineHeight: 1.15,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Support tickets that feel
            <br />
            like an inbox
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.65,
              color: "var(--muted)",
              maxWidth: 560,
              margin: "18px auto 0",
            }}
          >
            Postbox turns your website&rsquo;s contact form and support email
            into one clean, threaded inbox. Reply from Postbox — customers get
            a real email, and their answers thread right back.
          </p>
          <div style={{ marginTop: 30 }}>
            <span
              style={{
                display: "inline-block",
                fontSize: 13.5,
                fontWeight: 600,
                // --accent-text, not --accent-strong: this is text on
                // --accent-soft, and every theme pairs those two (see
                // .pbm-tag--order). --accent-strong is the deep plate colour
                // and scores ~2:1 on the dark themes' soft fill.
                color: "var(--accent-text)",
                background: "var(--accent-soft)",
                border: "1px solid var(--accent-line)",
                borderRadius: 20,
                padding: "8px 16px",
              }}
            >
              Currently invite-only — ask your provider for access
            </span>
          </div>
        </section>

        {/* how it works */}
        <section
          style={{
            maxWidth: 980,
            margin: "0 auto",
            padding: "24px 24px 72px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {[
            {
              title: "Everything becomes a ticket",
              body: "Contact-form submissions and forwarded support email land in one inbox. Order numbers are spotted automatically and flagged as priority.",
            },
            {
              title: "Reply like it's email — because it is",
              body: "Your replies send as real branded email. Customer responses thread back into the same ticket, and the whole conversation groups properly in their mail app.",
            },
            {
              title: "Set up in minutes",
              body: "Paste one snippet on your site — or hand your AI assistant our ready-made integration prompt. Forward your support address and you're done.",
            },
          ].map((f) => (
            <div
              key={f.title}
              style={{
                // Not #fff: five of the six themes are dark grounds, and a
                // white card with var(--muted) text on them is unreadable.
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "24px 22px",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
                {f.title}
              </h2>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.65,
                  color: "var(--muted)",
                  margin: 0,
                }}
              >
                {f.body}
              </p>
            </div>
          ))}
        </section>

        {/*
          ── NEWSLETTERS ──
          This section exists for two audiences and both matter.

          The client: the product does bulk marketing email now, and a landing
          page that only describes a support inbox undersells half of it.

          The reviewer: Amazon denied our first SES production-access request
          (case 178747420600793). The eu-west-1 form has no free-text field, so
          the assessment is made against this website — and a MARKETING request
          judged against a page describing a support-ticket tool is a mismatch
          a reviewer is right to refuse. Everything below is a plain statement
          of what the code actually does, which is also exactly what a sending
          platform is expected to be able to show.
        */}
        <section
          id="newsletters"
          style={{
            maxWidth: 980,
            margin: "0 auto",
            padding: "0 24px 72px",
          }}
        >
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>
            Newsletters, sent properly
          </h2>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.7,
              color: "var(--muted)",
              margin: "0 0 20px",
              maxWidth: 640,
            }}
          >
            The same workspace sends your newsletter. People subscribe from a
            form on your own site, and every part of the process is built so you
            can show, later, that they asked for it.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {[
              {
                title: "Confirmed opt-in only",
                body: "Someone enters their address, we email them a confirmation link, and nothing is stored until they press it. No purchased lists, no imported addresses, no way to add a subscriber who never clicked.",
              },
              {
                title: "A record of every consent",
                body: "For each subscriber we keep how they subscribed, the moment they confirmed, the page the form was on, and the IP the confirmation came from. An address with no consent record is excluded from every send.",
              },
              {
                title: "One-click unsubscribe",
                body: "Every newsletter carries a one-click unsubscribe header and a visible link. No login, no account, no questions — and the address is suppressed immediately, for good.",
              },
              {
                title: "Bounces and complaints act on themselves",
                body: "Hard bounces and spam complaints are fed straight back into a suppression list, so an address that failed or objected is never sent to again. Your postal address appears in every message, as the law requires.",
              },
            ].map((f) => (
              <div
                key={f.title}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 16,
                  padding: "24px 22px",
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
                  {f.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.65,
                    color: "var(--muted)",
                    margin: 0,
                  }}
                >
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border-soft)",
          padding: "18px 24px",
          fontSize: 12.5,
          color: "var(--muted-2)",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          maxWidth: 980,
          width: "100%",
          margin: "0 auto",
        }}
      >
        <span>© 2026 Postbox · postbox.help</span>
        <span style={{ display: "flex", gap: 14 }}>
          <Link href="/terms" style={{ color: "var(--muted-2)" }}>
            Terms
          </Link>
          <Link href="/privacy" style={{ color: "var(--muted-2)" }}>
            Privacy
          </Link>
        </span>
      </footer>
    </div>
  );
}
