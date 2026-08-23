export const metadata = { title: "Privacy Policy — Postbox" };

export default function PrivacyPage() {
  return (
    <article>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px" }}>
        Privacy Policy
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Last updated: 23 August 2026
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
        For mailing lists we store, for each subscriber: the email address, a
        name if one was given, which lists they belong to, the dates they
        subscribed and unsubscribed, and four separate pieces of consent
        evidence &mdash; the <strong>method</strong> consent was captured by,
        the <strong>date and time</strong> it was captured, a{" "}
        <strong>description of where</strong> it came from (normally the URL of
        the page the signup form was on), and the{" "}
        <strong>IP address</strong> the confirmation click arrived from.
      </p>
      <p>
        The IP address is named separately because it is personal data in its
        own right and it is easy to miss in a list. It is recorded once, at the
        moment someone confirms their subscription, and never updated after
        that. It is stored exactly as our host handed it to us and is never
        matched against anything, geolocated, or used to identify anyone
        outside of a question about whether a particular subscription was real.
        Where a subscription genuinely has no IP behind it, the field is left
        empty rather than filled with a guess.
      </p>
      <p>
        We also keep, per workspace: a suppression list of addresses that must
        never be mailed again (the address, the reason, a note, and the date),
        and a per-message send log for each campaign (the address the message
        went to, when, whether it was delivered, and any bounce or complaint the
        provider reported).
      </p>
      <p>
        Two short-lived technical records are worth naming. Rate-limit counters
        on our public endpoints are keyed by IP address; they are deleted 24
        hours after they are written. Error reports are covered separately
        below.
      </p>

      <h2 style={h2}>How it&rsquo;s used</h2>
      <p>
        Solely to operate the service: creating tickets, sending replies and
        notifications, threading conversations, and sending campaigns our
        clients compose to lists they own. We do not sell data, use it for
        advertising, or train models on it. We do not mail anyone on our own
        behalf from a client&rsquo;s list, and we never combine one
        client&rsquo;s data with another&rsquo;s.
      </p>
      <p>
        Support contacts and marketing subscribers are kept in separate tables
        with no link between them, on purpose. Raising a support ticket is not
        consent to receive marketing, and there is no feature that copies a
        contact into a mailing list.
      </p>

      <h2 style={h2}>Marketing email</h2>
      <div style={notBuilt}>
        <strong>Signup forms are live. Sending is not.</strong>{" "}
        These two halves have different statuses and it matters which one you
        are asking about. The hosted signup form is live: people are confirming
        subscriptions today, and everything described in this section about
        collection, consent and unsubscribing applies to them now. Campaign{" "}
        <em>delivery</em> is not yet available to clients. The composer,
        audience selection, the scheduler, the unsubscribe endpoint and the
        Amazon SES integration are all built and switched on, and on 23 August
        2026 we sent one test message through them &mdash; to our own operator
        address, to check it arrived correctly. Our Amazon account is still
        restricted to addresses we have verified ourselves, so no campaign has
        been delivered to a subscriber, and no subscriber has received anything
        beyond the confirmation email they asked for.
      </div>
      <p>
        <strong>How someone gets on a list.</strong>{" "}
        There is exactly one way, and it is double opt-in. Someone enters their
        address on a signup form; we write nothing at all; we send one email
        containing a link; they open it and press a button on the page it leads
        to. Only then does a subscriber record come into existence. If the link
        is never clicked, no record of that submission is ever created &mdash;
        an unconfirmed signup leaves nothing behind. The link is a signed token,
        so nobody can mint one for an address they do not control, and it
        expires after 14 days.
      </p>
      <p>
        Two details are deliberate. Clicking the link in your mail client does
        not subscribe you on its own &mdash; a button press on the page does,
        because corporate mail scanners open every link in a message and we will
        not let a scanner consent on your behalf. And the consent timestamp we
        record is the moment of <em>confirmation</em>, not of submission:
        somebody typing an address into a form is not evidence that the person
        who owns it agreed.
      </p>
      <p>
        <strong>There is currently no import feature.</strong>{" "}
        Postbox has no way for a client to upload a spreadsheet of addresses, or
        to add a subscriber by hand from the dashboard. The signup form is the
        only route in. If that changes, this paragraph changes with it.
      </p>
      <p>
        <strong>Lawful basis.</strong>{" "}
        We do not choose it &mdash; the client does, as controller. In the UK
        and EU, marketing email to individuals normally requires consent under
        PECR and the GDPR, or fits the narrow &ldquo;soft opt-in&rdquo; for a
        business&rsquo;s own existing customers. Postbox&rsquo;s role is to make
        that basis evidenceable, and to refuse to send where the evidence is
        missing. A subscriber with no consent timestamp is skipped when a
        campaign&rsquo;s audience is built: they are not mailed, and the number
        skipped for that reason is shown to the client in the composer. An
        address whose provenance we cannot show is an address we do not mail.
      </p>
      <p>
        <strong>Sender identification.</strong>{" "}
        Every campaign carries the client&rsquo;s legal name and a physical
        postal address, which they enter in their settings. A workspace that has
        not supplied a postal address cannot send at all &mdash; we refuse the
        whole send rather than produce a message with the field left out or
        filled in with something plausible.
      </p>
      <p>
        <strong>Withdrawing consent.</strong>{" "}
        Every campaign carries a working unsubscribe link in both the plain-text
        and HTML versions, appended by the system to every message. Clients
        cannot turn it off or remove it. Messages also carry the{" "}
        <code>List-Unsubscribe</code> and <code>List-Unsubscribe-Post</code>{" "}
        headers, so the unsubscribe button built into Gmail, Outlook and Apple
        Mail works in one click without opening the email.
      </p>
      <p>
        <strong>What an unsubscribe does.</strong>{" "}
        It takes effect in the same request, with no confirmation step for the
        one-click version, and it applies to the whole workspace rather than to
        the one list the campaign drew from. Someone who opts out has not
        consented to the next message from the same sender under a different
        list name. The address is added to that workspace&rsquo;s suppression
        list and the subscriber record is marked unsubscribed, together, in a
        single database statement, so there is no window in which one happened
        and the other did not. Unsubscribing twice is harmless. Unsubscribing
        from marketing does not stop transactional support replies, which are a
        different thing: if you have an open ticket with a business, they can
        still reply to it.
      </p>
      <p>
        <strong>Bounces and complaints.</strong>{" "}
        Amazon tells us when a message hard-bounces or when a recipient presses
        their mail client&rsquo;s spam button. Both are treated as permanent:
        the address is added to that workspace&rsquo;s suppression list and the
        subscriber record is marked accordingly, and it will not be mailed
        again. Temporary failures &mdash; a full mailbox, a server that was down
        &mdash; are recorded against the individual message for the
        client&rsquo;s delivery report and block nothing, because a temporary
        failure is not evidence that an address is bad. The feedback we receive
        is the address, the failure type and the provider&rsquo;s diagnostic
        text; the diagnostic is stored with the suppression and can be seen by
        the client.
      </p>
      <p>
        <strong>Retention of subscriber data.</strong>{" "}
        Nothing expires on its own. There is no automatic deletion of dormant
        subscribers, of unsubscribed subscribers, or of campaign send logs
        &mdash; how long a list is kept is the client&rsquo;s decision as
        controller, and today the only thing that removes subscriber data is
        deleting the whole workspace, which wipes its subscribers, lists,
        suppressions, campaigns and send logs outright. See &ldquo;Deletion,
        and what we cannot do yet&rdquo; below, which is blunter about this than
        most policies are.
      </p>
      <p>
        Two things are kept on purpose after someone is removed from a list.
        The first is the suppression entry: deleting it would mean a re-imported
        spreadsheet or a fresh signup could silently resurrect someone who asked
        us to stop, so it survives, holding only the address, the reason, a note
        and the date. The second is the send log. It records that a particular
        message went to a particular address on a particular date, and it keeps
        that address even if the subscriber record it belonged to is removed.
        That is the evidence that an opt-out was honoured or that a complaint
        was acted on, and destroying it at the moment it becomes relevant is not
        something we are willing to build.
      </p>

      <h2 style={h2}>Who processes it</h2>
      <p>
        Postbox runs on infrastructure providers acting as sub-processors:
        Vercel (hosting), Neon (database), Clerk (authentication and sign-in),
        Resend (transactional email &mdash; sending and receiving), Amazon Web
        Services (marketing email delivery, see below), Cloudflare (DNS only,
        which does not carry message content), and Sentry (error monitoring).
        The application and the database are hosted in London, in the UK. Where
        a provider offers a regional choice we take a UK or EU one; the specific
        regions are named below where they differ.
      </p>
      <p>
        <strong>Resend</strong> carries all transactional mail: ticket replies,
        auto-replies, notifications, workspace invitations, and the double
        opt-in confirmation email sent to someone who fills in a signup form.
        That last one is worth stating plainly &mdash; a prospective
        subscriber&rsquo;s address passes through Resend before any campaign
        machinery is involved. Resend also receives inbound customer email on
        our clients&rsquo; behalf.
      </p>
      <p>
        <strong>Amazon Simple Email Service</strong> is the provider configured
        to carry marketing campaigns, in the AWS Europe (Ireland) region. When a
        campaign sends, SES receives the recipient&rsquo;s email address and the
        full content of the message &mdash; including any personalised fields
        and the unsubscribe link unique to that recipient &mdash; and returns
        delivery, bounce and complaint information about that address. It does
        not carry ticket replies, notifications or confirmation emails; those go
        through Resend. As set out above, campaign delivery is currently
        switched off, so nothing has yet been sent through it.
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

      <h2 style={h2}>Deletion, and what we cannot do yet</h2>
      <p>
        Deleting a workspace permanently removes its tickets, messages,
        contacts, subscribers, lists, suppressions, campaigns and send logs.
        That is a real, immediate deletion and it is the only one the product
        performs today. Clients can ask us to do it at any time.
      </p>
      <p>
        Below that level, the honest position is that the software has no
        delete button. There is no way for a client to delete an individual
        subscriber, contact or ticket from the dashboard, and no self-service
        route for an individual to erase themselves. A request to remove one
        person is carried out by hand, by us, against the database. We do
        honour verified requests and we will confirm when it is done, but we
        are not going to describe a manual operation as if it were a feature.
        A self-service deletion tool is something we intend to build; it does
        not exist as of the date at the top of this page.
      </p>
      <p>
        Two exceptions survive an individual deletion, both described above and
        both deliberate: the suppression entry, so an opt-out keeps being
        honoured, and the campaign send log, so the record of what was sent
        where remains intact. Both are scoped to the single workspace that
        holds them.
      </p>

      <h2 style={h2}>Your rights</h2>
      <p>
        Depending on your jurisdiction (including under UK/EU GDPR) you may
        have rights to access, correct, export, or erase personal data, and to
        object to direct marketing at any time. To exercise them, reply to any
        Postbox email or contact your account provider. Where we hold the data
        as a processor we will pass the request to the client who controls it
        and assist them in answering it.
      </p>
      <p>
        On export, specifically: clients can download their workspace data as a
        JSON file from within Postbox, and that file contains tickets, messages
        and support contacts. It does <em>not</em> currently include
        subscribers, lists, campaigns or suppressions &mdash; the export was
        written before the mailing-list side existed and has not caught up. An
        export covering the newsletter data is produced on request in the
        meantime.
      </p>

      <h2 style={h2}>Cookies</h2>
      <p>
        Only functional cookies are used: the authentication session and, for
        our own operators, which client workspace they are currently acting
        within. No tracking or advertising cookies. The public pages &mdash; the
        signup form, the confirmation page and the unsubscribe pages &mdash; set
        no cookies at all.
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
 * Explicit "the status here is not what you would assume" marker. Rule 5 of
 * AGENTS.md applied to prose: a policy that describes an unbuilt feature in the
 * present tense is a lie with a legal shape, and a policy that describes a LIVE
 * feature as unbuilt is the same mistake pointed the other way. Signup is live
 * and delivery is not, so the box now separates them rather than covering the
 * whole section in one "not yet".
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
