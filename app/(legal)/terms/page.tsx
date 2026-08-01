export const metadata = { title: "Terms of Service — Postbox" };

export default function TermsPage() {
  return (
    <article>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px" }}>
        Terms of Service
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Last updated: 1 August 2026
      </p>

      <h2 style={h2}>1. The service</h2>
      <p>
        Postbox (&ldquo;the service&rdquo;, postbox.help) is a hosted support
        inbox: it receives messages from your website&rsquo;s contact form and
        forwarded email, stores them as tickets, and sends your replies as
        email on your behalf. The service is currently provided on an
        invite-only basis.
      </p>

      <h2 style={h2}>2. Accounts</h2>
      <p>
        You are responsible for activity under your account and for keeping
        your sign-in method secure. You must provide accurate information and
        be authorised to act for the business your workspace represents.
      </p>

      <h2 style={h2}>3. Acceptable use</h2>
      <p>
        Don&rsquo;t use Postbox to send spam or unlawful content, to violate
        others&rsquo; privacy, or to attempt to access other tenants&rsquo;
        data. We may suspend workspaces that threaten the service&rsquo;s
        integrity or email deliverability.
      </p>

      <h2 style={h2}>4. Your data</h2>
      <p>
        Your tickets, contacts, and messages remain yours. We process them
        only to operate the service, as described in the{" "}
        <a href="/privacy">Privacy Policy</a>. You can request deletion of
        your workspace and its data at any time.
      </p>

      <h2 style={h2}>5. Availability & changes</h2>
      <p>
        The service is provided &ldquo;as is&rdquo;, without warranty of
        uninterrupted availability. Features may change as the product
        evolves; material changes to these terms will be notified to the
        account email.
      </p>

      <h2 style={h2}>6. Liability</h2>
      <p>
        To the maximum extent permitted by law, our liability for any claim
        arising from the service is limited to the amount you paid for it in
        the preceding 12 months.
      </p>

      <h2 style={h2}>7. Contact</h2>
      <p>
        Questions about these terms: reply to any Postbox email, or contact
        your account provider.
      </p>
    </article>
  );
}

const h2: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  margin: "26px 0 6px",
};
