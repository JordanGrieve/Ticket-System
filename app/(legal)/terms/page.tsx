export const metadata = { title: "Terms of Service — Postbox" };

export default function TermsPage() {
  return (
    <article>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px" }}>
        Terms of Service
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Last updated: 22 August 2026
      </p>

      <h2 style={h2}>1. The service</h2>
      <p>
        Postbox (&ldquo;the service&rdquo;, postbox.help) is a hosted support
        inbox: it receives messages from your website&rsquo;s contact form and
        forwarded email, stores them as tickets, and sends your replies as
        email on your behalf. The service is currently provided on an
        invite-only basis.
      </p>
      <p>
        Postbox is also being extended to send marketing email &mdash;
        newsletters and campaigns &mdash; to mailing lists you own. Sections 5
        and 6 set out the terms for that, and they bind you from the moment the
        feature is available to your workspace.
      </p>
      <div style={notBuilt}>
        <strong>Not available yet.</strong>{" "}
        No campaign has ever been delivered to anyone, and none can be today.
        Subscriber lists, campaigns, audience selection, unsubscribe handling
        and a delivery integration are all built, but delivery is switched off:
        the system is configured to record what a campaign would have sent and
        to transmit nothing, and turning that off is a deliberate configuration
        change we have not made. Nothing in these terms should be read as an
        offer of a working marketing-email feature today, or as a commitment to
        a date.
      </div>

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
      <p>
        Deliverability is shared. Postbox sends from infrastructure used by
        every workspace, so one sender&rsquo;s spam complaints degrade
        everyone&rsquo;s mail &mdash; including support replies from businesses
        with nothing to do with it. That is why the marketing rules below are
        conditions of use rather than advice.
      </p>

      <h2 style={h2}>4. Your data, and who controls it</h2>
      <p>
        Your tickets, contacts, messages, subscribers and campaigns remain
        yours. We process them only to operate the service, as described in the{" "}
        <a href="/privacy">Privacy Policy</a>. You can request deletion of your
        workspace and its data at any time.
      </p>
      <p>
        In data-protection terms: <strong>you are the controller</strong>{" "}
        of the people in your workspace &mdash; those who contact you and those on
        your lists &mdash; and <strong>Postbox is your processor</strong>. We
        act on your instructions and use your data for no purpose of our own.
        The consequence is that the legal duties owed to those people are
        yours: establishing a lawful basis for contacting them, answering their
        access and erasure requests, and being able to show a regulator why
        each address is on your list. We will help you meet them and will pass
        on any request that reaches us, but we cannot discharge them for you.
      </p>

      <h2 style={h2}>5. Sending marketing email</h2>
      <p>
        When you use Postbox to send campaigns, you confirm on each send that
        every recipient has given you permission you can evidence, or otherwise
        falls within a lawful basis you have identified for direct marketing.
        Specifically, you must not upload or mail:
      </p>
      <ul>
        <li>purchased, rented, scraped or otherwise third-party lists;</li>
        <li>
          addresses whose origin you cannot account for, including imports
          where the consent record is guessed or backfilled;
        </li>
        <li>
          your Postbox support contacts, unless they separately opted in to
          marketing. Raising a ticket is not consent, which is why the two are
          kept in separate lists with no way to copy between them.
        </li>
      </ul>
      <p>
        You are responsible for the content of your campaigns, including
        accurate sender identification and any disclosures your jurisdiction
        requires.
      </p>

      <h2 style={h2}>6. Unsubscribes and suppression</h2>
      <p>
        Every campaign sent through Postbox carries an unsubscribe link, added
        by the system to both the plain-text and HTML versions of the message,
        plus one-click unsubscribe headers. This is not configurable and must
        not be circumvented &mdash; removing, obscuring or breaking it, or
        mailing an address after it has opted out, is grounds for immediate
        suspension.
      </p>
      <p>
        Unsubscribes take effect immediately and always within 48 hours.
        Addresses that unsubscribe, hard bounce, or report a message as spam
        are added to your workspace&rsquo;s suppression list and are skipped on
        every subsequent send regardless of list membership. Re-importing a
        suppressed address does not clear the suppression, and asking us to
        clear one for a person who opted out is a request we will refuse.
      </p>
      <p>
        We may throttle, pause or stop a campaign that is generating bounces or
        complaints at a rate that threatens delivery for other workspaces, and
        we will tell you when we do.
      </p>

      <h2 style={h2}>7. Availability & changes</h2>
      <p>
        The service is provided &ldquo;as is&rdquo;, without warranty of
        uninterrupted availability. Features may change as the product evolves;
        material changes to these terms will be notified to the account email.
        Email delivery depends on third parties and on receiving mail servers,
        so we cannot guarantee that any individual message arrives or reaches
        an inbox rather than a spam folder.
      </p>

      <h2 style={h2}>8. Liability</h2>
      <p>
        To the maximum extent permitted by law, our liability for any claim
        arising from the service is limited to the amount you paid for it in
        the preceding 12 months. Nothing here limits liability that cannot
        lawfully be limited. Claims arising from marketing you chose to send
        &mdash; to recipients you selected, with content you wrote &mdash; are
        yours, and you will cover us for penalties or third-party claims caused
        by a breach of sections 3, 5 or 6.
      </p>

      <h2 style={h2}>9. Contact</h2>
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

/**
 * Explicit "this does not exist yet" marker. Mirrors the one on /privacy: the
 * marketing terms are written to bind before the first send, not to advertise
 * a capability the send path cannot currently perform.
 */
const notBuilt: React.CSSProperties = {
  background: "var(--warn-bg)",
  // See the note on /privacy: --warn-fg is a badge colour and is not contrasty
  // enough for a paragraph, so it carries the rule and --text carries the copy.
  color: "var(--text)",
  borderLeft: "3px solid var(--warn-fg)",
  borderRadius: "0 8px 8px 0",
  padding: "10px 14px",
  margin: "10px 0 14px",
};
