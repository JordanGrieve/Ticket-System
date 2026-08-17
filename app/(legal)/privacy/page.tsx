export const metadata = { title: "Privacy Policy — Postbox" };

export default function PrivacyPage() {
  return (
    <article>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px" }}>
        Privacy Policy
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Last updated: 17 August 2026
      </p>

      <h2 style={h2}>Who is responsible for what</h2>
      <p>
        Postbox is sold to businesses, and most of the personal data in it
        belongs to <em>their</em> customers, not ours. Two different roles
        apply, and the difference decides who you ask about what:
      </p>
      <ul>
        <li>
          <strong>Our clients are the controllers</strong>{" "}
          of the people in their workspace &mdash; everyone who contacts them, and everyone on
          a mailing list they build. They decide who goes in, why, and for how
          long. We act as their <strong>processor</strong>: we handle that data
          on their documented instructions and for no purpose of our own.
        </li>
        <li>
          <strong>We are the controller</strong>{" "}
          of our own client accounts
          &mdash; the name, email address and sign-in method of the people who
          administer a workspace, plus billing and support correspondence with
          them.
        </li>
      </ul>
      <p>
        So if you were emailed by a business using Postbox, or raised a ticket
        with one, that business decides what happens to your data. You can
        contact us and we will help, but we will normally route the request to
        them.
      </p>

      <h2 style={h2}>What we store</h2>
      <p>
        To run a support inbox we store: workspace details, the names and email
        addresses of people who contact a workspace, the content of their
        messages and your replies, and email metadata (such as Message-IDs)
        used to thread conversations correctly.
      </p>
      <p>
        For mailing lists we store: subscriber email addresses and names, which
        lists they belong to, subscription and unsubscription dates, and a
        record of how and when consent was captured (the method, the date, and
        evidence such as the URL of the form or the name of the imported file).
        We also keep a per-workspace suppression list of addresses that must
        never be mailed again.
      </p>

      <h2 style={h2}>How it&rsquo;s used</h2>
      <p>
        Solely to operate the service: creating tickets, sending replies and
        notifications, threading conversations, and &mdash; once the feature
        below is live &mdash; sending campaigns our clients compose to lists
        they own. We do not sell data, use it for advertising, or train models
        on it. We do not mail anyone on our own behalf from a client&rsquo;s
        list, and we never combine one client&rsquo;s data with another&rsquo;s.
      </p>
      <p>
        Support contacts and marketing subscribers are kept in separate tables
        with no link between them, on purpose. Raising a support ticket is not
        consent to receive marketing, and there is no feature that copies a
        contact into a mailing list.
      </p>

      <h2 style={h2}>Marketing email</h2>
      <div style={notBuilt}>
        <strong>Not live yet.</strong>{" "}
        The database tables, the audience logic
        and the unsubscribe token design exist in the product, but there is no
        send path: no campaign has ever been sent to anyone, and the code
        cannot reach an email provider. This section describes the rules that
        will govern the feature when it is switched on, so that they are on
        record before the first send rather than after it.
      </div>
      <p>
        <strong>Lawful basis.</strong>{" "}
        We do not choose it &mdash; the client
        does, as controller. In the UK and EU, marketing email to individuals
        normally requires consent under PECR and the GDPR, or fits the narrow
        &ldquo;soft opt-in&rdquo; for a business&rsquo;s own existing
        customers. Postbox&rsquo;s role is to make that basis evidenceable: we
        record the consent method, the timestamp and the source alongside every
        subscriber, and we refuse to invent them. Addresses imported without
        provenance are stored, but the intention is that the send path will
        decline to mail them. That check is <em>not</em> written yet, which is
        one of the reasons sending stays disabled.
      </p>
      <p>
        <strong>Withdrawing consent.</strong>{" "}
        Every campaign will carry a
        working unsubscribe link in both the plain-text and HTML versions,
        appended by the system to every message. Clients cannot turn it off or
        remove it. Messages will also carry the{" "}
        <code>List-Unsubscribe</code> and <code>List-Unsubscribe-Post</code>{" "}
        headers, so the unsubscribe button built into Gmail, Outlook and Apple
        Mail works in one click without opening the email.
      </p>
      <p>
        <strong>Unsubscribe guarantee.</strong>{" "}
        An unsubscribe will take effect
        on receipt, without a confirmation step to click through: our
        commitment is that no further campaign goes to that address, and that
        it will never take longer than 48 hours to apply. Unsubscribing from marketing does
        not stop transactional support replies, which are a different thing: if
        you have an open ticket with a business, they can still reply to it.
      </p>
      <p>
        <strong>Retention of subscriber data.</strong>{" "}
        Subscriber records last
        as long as the workspace does; deleting a workspace deletes its
        subscribers, lists and campaign history outright. We have no automatic
        expiry for dormant subscribers &mdash; how long a list is kept is the
        client&rsquo;s decision as controller.
      </p>
      <p>
        One deliberate exception: when someone unsubscribes, or an address hard
        bounces or reports a message as spam, we keep that address on the
        workspace&rsquo;s suppression list <em>after</em> removing them from
        the list itself. Deleting the record entirely would mean a re-imported
        spreadsheet could silently resurrect someone who asked us to stop. The
        suppression entry holds only the email address, the reason and the
        date, and it exists solely to keep honouring the opt-out.
      </p>

      <h2 style={h2}>Who processes it</h2>
      <p>
        Postbox runs on vetted infrastructure providers acting as
        sub-processors: Vercel (hosting), Neon (database, EU region), Clerk
        (authentication), Resend (email delivery and receiving), Cloudflare
        (DNS), and Sentry (error monitoring). Data is stored in the EU (London
        region) where the provider offers a choice.
      </p>

      <h2 style={h2}>Error monitoring</h2>
      <p>
        Sentry receives an event when something breaks. That event can contain
        fragments of a client&rsquo;s or their customer&rsquo;s data: a stack
        trace, the URL of the page or API route that failed (which may include
        a ticket or workspace identifier), and a coarse location derived from
        the IP address of whoever hit the error. It is genuinely a
        sub-processor and we list it as one.
      </p>
      <p>
        The SDK is configured to send as little as it can. Request bodies,
        request headers, authenticated user identity and local variables are
        all switched off, so message content and contact details are not
        collected in the normal case &mdash; that is the SDK&rsquo;s
        conservative default and we have not overridden it. Session Replay,
        which would record an agent&rsquo;s screen while they read real support
        threads, is deliberately not enabled. Errors are captured in full; a
        10% sample of performance traces is also sent. The Sentry project is in
        Sentry&rsquo;s EU region, so events do not leave the EEA in the normal
        course.
      </p>
      <p>
        We cannot promise a stack trace will never incidentally carry an
        identifier &mdash; that is the nature of error reporting &mdash; only
        that we have turned off every channel that would carry it
        systematically.
      </p>

      <h2 style={h2}>Retention & deletion</h2>
      <p>
        Data is kept while the workspace exists. Deleting a workspace
        permanently removes its tickets, messages, contacts, subscribers, lists
        and campaign records. Individuals can ask the business they contacted
        (or us) to remove their personal data; verified requests are honoured.
        The suppression-list exception described above is the one thing that
        survives an individual deletion, and only within the workspace that
        holds it.
      </p>

      <h2 style={h2}>Your rights</h2>
      <p>
        Depending on your jurisdiction (including under UK/EU GDPR) you may
        have rights to access, correct, export, or erase personal data, and to
        object to direct marketing at any time. To exercise them, reply to any
        Postbox email or contact your account provider. Where we hold the data
        as a processor we will pass the request to the client who controls it
        and assist them in answering it. A self-service data export is on our
        roadmap; until then, exports are handled on request.
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

/**
 * Explicit "this does not exist yet" marker. Rule 5 of AGENTS.md applied to
 * prose: a policy that describes an unbuilt feature in the present tense is a
 * lie with a legal shape, so the gap is rendered rather than smoothed over.
 */
const notBuilt: React.CSSProperties = {
  background: "var(--warn-bg)",
  // Body copy takes --text, not --warn-fg: the warn pair is tuned for small
  // badges and drops under 4.5:1 for a paragraph in the light themes. The
  // warning colour carries the rule instead, where contrast doesn't apply.
  color: "var(--text)",
  borderLeft: "3px solid var(--warn-fg)",
  borderRadius: "0 8px 8px 0",
  padding: "10px 14px",
  margin: "10px 0 14px",
};
