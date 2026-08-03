export const metadata = { title: "Privacy Policy — Postbox" };

export default function PrivacyPage() {
  return (
    <article>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px" }}>
        Privacy Policy
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Last updated: 1 August 2026
      </p>

      <h2 style={h2}>What we store</h2>
      <p>
        To run a support inbox we store: workspace details, the names and
        email addresses of people who contact a workspace, the content of
        their messages and your replies, and email metadata (such as
        Message-IDs) used to thread conversations correctly.
      </p>

      <h2 style={h2}>How it&rsquo;s used</h2>
      <p>
        Solely to operate the service: creating tickets, sending replies and
        notifications, and threading conversations. We do not sell data, use
        it for advertising, or train models on it.
      </p>

      <h2 style={h2}>Who processes it</h2>
      <p>
        Postbox runs on vetted infrastructure providers acting as
        sub-processors: Vercel (hosting), Neon (database, EU region), Clerk
        (authentication), Resend (email delivery and receiving), and
        Cloudflare (DNS). Data is stored in the EU (London region) where the
        provider offers a choice.
      </p>

      <h2 style={h2}>Retention & deletion</h2>
      <p>
        Data is kept while the workspace exists. Deleting a workspace
        permanently removes its tickets, messages, and contacts. Individuals
        can ask the business they contacted (or us) to remove their personal
        data; verified requests are honoured.
      </p>

      <h2 style={h2}>Your rights</h2>
      <p>
        Depending on your jurisdiction (including under UK/EU GDPR) you may
        have rights to access, correct, export, or erase personal data. To
        exercise them, reply to any Postbox email or contact your account
        provider. A self-service data export is on our roadmap; until then,
        exports are handled on request.
      </p>

      <h2 style={h2}>Cookies</h2>
      <p>
        Only functional cookies are used: authentication sessions and, for
        administrators, the currently selected workspace. No tracking or
        advertising cookies.
      </p>
    </article>
  );
}

const h2: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  margin: "26px 0 6px",
};
