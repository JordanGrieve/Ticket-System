import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { initials } from "@/lib/ticket-format";
import { getSubscriberDetail } from "../queries";
import {
  CONSENT_METHOD_LABEL,
  STATUS_LABEL,
  WEAK_CONSENT_METHODS,
} from "../labels";
import "../../../subscribers.css";

export const metadata = { title: "Subscriber · Postbox" };

/**
 * /subscribers/[id] — the consent evidence bundle for one address.
 *
 * This is the screen you put in front of a regulator, an ICO complaint, or a
 * deliverability review, so it is built around one rule: it never lets missing
 * evidence look like present evidence. A field we do not have renders as a red
 * "Not recorded", not as a blank cell or an em-dash, and if the core of the
 * record is absent the page leads with a banner saying so before it shows
 * anything else. The schema's own comment on subscribers.consentMethod is
 * explicit that nothing may backfill these columns; the corollary is that the
 * UI must not paper over the nulls either.
 *
 * ── TENANCY ──
 * The id in the URL is user input. It is parsed as an integer and then handed
 * to getSubscriberDetail() ALONGSIDE the workspace id from resolveViewer(),
 * which puts both in the same WHERE clause. There is no "load by id, then
 * check the workspace afterwards" step anywhere in this route — that pattern
 * leaks through timing and through any early return that forgets the check.
 * A subscriber belonging to another tenant is indistinguishable from one that
 * does not exist: both are notFound().
 *
 * Timestamps are rendered in UTC, spelled out. Formatting a Date on the server
 * gives every viewer the server's zone (see lib/serialize.ts), and on an
 * evidence screen an unlabelled local-looking timestamp is worse than a
 * labelled absolute one.
 */
export default async function SubscriberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const subscriberId = Number((await params).id);
  if (!Number.isInteger(subscriberId) || subscriberId < 1) notFound();

  const detail = await getSubscriberDetail(workspace.id, subscriberId);
  if (!detail) notFound();

  const { subscriber: s, lists, suppression } = detail;

  // The two columns that make a record a record. Everything else qualifies it.
  const hasCore = s.consentMethod !== null && s.consentAt !== null;
  // Narrowed once, here, so the JSX below never needs a non-null assertion.
  const methodLabel =
    s.consentMethod === null ? null : CONSENT_METHOD_LABEL[s.consentMethod];
  const weakMethod =
    s.consentMethod !== null && WEAK_CONSENT_METHODS.includes(s.consentMethod);
  const thinEvidence = hasCore && (s.consentSource === null || weakMethod);

  return (
    <div className="pbm-page pb-scroll">
      <div className="psb-wrap">
        <div className="psb-col">
          <Link href="/subscribers" className="psb-back">
            ← All subscribers
          </Link>

          <header className="psb-identity">
            <span className="psb-avatar" aria-hidden>
              {initials(s.name ?? s.email)}
            </span>
            <span className="psb-identity-text">
              <h1 className="psb-identity-email">{s.email}</h1>
              <p className="psb-identity-name">
                {s.name ?? "No name on record"}
              </p>
            </span>
            <span className="psb-chip" data-status={s.status}>
              {STATUS_LABEL[s.status]}
            </span>
          </header>

          {/*
            The verdict, before the detail. A page that opened with a tidy
            table of four rows — three of them empty — would let "we have no
            permission to mail this person" pass for a rendering gap.
          */}
          {!hasCore ? (
            <div className="psb-banner" data-tone="bad" role="status">
              <p className="psb-banner-title">No consent on record</p>
              <p className="psb-banner-body">
                Nothing was recorded about how or when this person agreed to be
                mailed
                {s.consentMethod === null && s.consentAt === null
                  ? ""
                  : s.consentMethod === null
                    ? " — there is a timestamp but no method, which on its own proves nothing"
                    : " — there is a method but no timestamp, which on its own proves nothing"}
                . Treat this address as one you cannot lawfully send marketing
                to until a fresh opt-in is captured. These fields are never
                backfilled, by design: inventing provenance would be worse than
                having none.
              </p>
            </div>
          ) : thinEvidence ? (
            <div className="psb-banner" data-tone="warn" role="status">
              <p className="psb-banner-title">Consent recorded, but thin</p>
              <p className="psb-banner-body">
                {weakMethod && methodLabel !== null
                  ? `This consent came from "${methodLabel.toLowerCase()}", which is a claim about an opt-in that happened somewhere else. `
                  : ""}
                {s.consentSource === null
                  ? "No source was captured — there is no form URL, checkbox wording or file name backing it up. "
                  : ""}
                It would not stand up on its own if this address complained.
              </p>
            </div>
          ) : (
            <div className="psb-banner" data-tone="ok" role="status">
              <p className="psb-banner-title">Consent on record</p>
              <p className="psb-banner-body">
                Method, timestamp and source are all present for this address.
              </p>
            </div>
          )}

          <section className="psb-card">
            <h2 className="psb-card-title">Consent evidence</h2>
            <p className="psb-card-note">
              Captured once, at opt-in, and never rewritten. This is separate
              from the subscription dates below: those say since when they have
              been on the list, these say what you can show someone who asks.
            </p>
            <dl className="psb-facts">
              <dt className="psb-fact-k">Method</dt>
              <dd className="psb-fact-v">
                {methodLabel === null ? <Missing /> : methodLabel}
              </dd>

              <dt className="psb-fact-k">Consented at</dt>
              <dd className="psb-fact-v">
                {s.consentAt === null ? <Missing /> : <Stamp at={s.consentAt} />}
              </dd>

              <dt className="psb-fact-k">Source</dt>
              <dd className="psb-fact-v">
                {s.consentSource === null ? (
                  <Missing />
                ) : (
                  <span className="psb-mono">{s.consentSource}</span>
                )}
              </dd>

              <dt className="psb-fact-k">IP address</dt>
              <dd className="psb-fact-v">
                {s.consentIp === null ? (
                  // Legitimately absent for a till, a phone call or a paper
                  // form, so this one is stated rather than accused.
                  <>
                    <Missing /> — expected when consent was not given over the
                    web.
                  </>
                ) : (
                  <span className="psb-mono">{s.consentIp}</span>
                )}
              </dd>
            </dl>
          </section>

          <section className="psb-card">
            <h2 className="psb-card-title">Subscription</h2>
            <dl className="psb-facts">
              <dt className="psb-fact-k">Status</dt>
              <dd className="psb-fact-v">{STATUS_LABEL[s.status]}</dd>

              <dt className="psb-fact-k">Source</dt>
              <dd className="psb-fact-v">
                {s.source === null ? (
                  // Not the loud <Missing />: `source` is a routing label, not
                  // evidence, and its absence blocks nothing.
                  "Not recorded"
                ) : (
                  <span className="psb-mono">{s.source}</span>
                )}
              </dd>

              <dt className="psb-fact-k">Subscribed</dt>
              <dd className="psb-fact-v">
                <Stamp at={s.subscribedAt} />
              </dd>

              {s.unsubscribedAt !== null && (
                <>
                  <dt className="psb-fact-k">Unsubscribed</dt>
                  <dd className="psb-fact-v">
                    <Stamp at={s.unsubscribedAt} />
                  </dd>
                </>
              )}

              <dt className="psb-fact-k">First seen</dt>
              <dd className="psb-fact-v">
                <Stamp at={s.createdAt} />
              </dd>
            </dl>
          </section>

          {suppression !== null && (
            <section className="psb-card">
              <h2 className="psb-card-title">Suppressed</h2>
              <p className="psb-card-note">
                This address is blocked workspace-wide, whatever the status
                above says and whatever list it is on. Every send skips it.
              </p>
              <dl className="psb-facts">
                <dt className="psb-fact-k">Reason</dt>
                <dd className="psb-fact-v">{suppression.reason}</dd>
                <dt className="psb-fact-k">Note</dt>
                <dd className="psb-fact-v">
                  {suppression.note ?? "None given"}
                </dd>
                <dt className="psb-fact-k">Blocked</dt>
                <dd className="psb-fact-v">
                  <Stamp at={suppression.createdAt} />
                </dd>
              </dl>
            </section>
          )}

          <section className="psb-card">
            <h2 className="psb-card-title">Lists</h2>
            {lists.length === 0 ? (
              <p className="psb-card-note psb-card-note--last">
                Not on any audience list, so no campaign will reach them.
              </p>
            ) : (
              <div className="psb-chips">
                {lists.map((l) => (
                  <span className="psb-listchip" key={l.id}>
                    {l.name}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** A field with nothing behind it. Loud on purpose — see the header. */
function Missing() {
  return <span className="psb-missing">Not recorded</span>;
}

/**
 * An absolute timestamp, in UTC, saying so. `<time>` carries the machine-
 * readable value for anyone copying it out of the page.
 */
function Stamp({ at }: { at: Date }) {
  const iso = at.toISOString();
  return (
    <time dateTime={iso} className="psb-mono">
      {iso.slice(0, 10)} {iso.slice(11, 19)} UTC
    </time>
  );
}
