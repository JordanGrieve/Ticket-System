import Link from "next/link";
import { recentIngestionFailures } from "@/lib/ingestion-log";
import { recentFeedbackDrops } from "@/lib/feedback-log";
import { recentAdminActions } from "@/lib/admin-audit";
import { verifyImpersonationLog } from "@/lib/impersonation";
// Not Clerk's <SignOutButton>: it runs only in the browser, so an operator
// signing out from here left their impersonation row open forever.
import AuditedSignOutButton from "@/components/AuditedSignOutButton";
import { resolveViewer } from "@/lib/viewer";
import { listAgentEmails, listWorkspaceSummaries } from "@/lib/data";
import { listAdmins } from "@/lib/admin";
import {
  listImpersonationSessions,
  listImpersonationSessionsForWorkspace,
} from "@/lib/impersonation";
import { stripeConfigured, stripePriceId } from "@/lib/stripe";
import { PLANS } from "@/lib/pricing";
import {
  campaignDeliveryTotals,
  listWorkspaceUsage,
  transactionalDeliveryTotals,
} from "./queries";
import type { ConsoleGates } from "./sections";
import {
  AccessSection,
  AccountDrawer,
  AccountsSection,
  BillingSection,
  DeliverabilitySection,
  OverviewSection,
  SupportSection,
} from "./sections";
import {
  EnvelopeIcon,
  FILTERS,
  SearchIcon,
  SECTIONS,
  accountStatus,
  needsAttention,
  hrefFor,
  type AdminQuery,
  type Filter,
  type Section,
} from "./ui";

/**
 * Postbox internal admin console.
 *
 * All state is in the URL — ?section, ?filter, ?q, ?account — so the whole
 * console is one Server Component with no client JavaScript, and the existing
 * Server Actions (create / invite / delete / impersonate / admins) keep working
 * unchanged.
 *
 * Where the design asked for numbers the product does not collect, the pane
 * says so instead of showing a figure. That list has shrunk — billing,
 * subscribers, plan state and both delivery paths are measured now — and what
 * remains is per-account sending domains and an operator support queue. See
 * sections.tsx.
 *
 * ── THE ENVIRONMENT IS READ HERE AND NOWHERE BELOW ──
 * Several cards have to say "that zero means nothing, the webhook that would
 * move it is not configured". The answers are gathered in this file and passed
 * down as props, the same arrangement lib/campaign-health.ts uses, so no
 * section component reaches into process.env and every one of them can be
 * reasoned about from what it is given.
 */

const PANE: Record<Section, { title: string; subtitle: string }> = {
  accounts: {
    title: "Accounts",
    subtitle: "Every client workspace, its owner and its enquiry volume.",
  },
  overview: {
    title: "Overview",
    subtitle: "The whole estate at a glance.",
  },
  access: {
    title: "Access log",
    subtitle: "Every time one of us went inside a client's data.",
  },
  billing: {
    title: "Billing",
    subtitle: "Invoices and payment state.",
  },
  deliverability: {
    title: "Deliverability",
    subtitle: "How mail leaves Postbox, and where it lands.",
  },
  support: {
    title: "Support",
    subtitle: "Requests from clients, and who on our side can answer them.",
  },
};

function parseSection(raw: string | undefined): Section {
  return SECTIONS.includes(raw as Section) ? (raw as Section) : "accounts";
}

function parseFilter(raw: string | undefined): Filter {
  return FILTERS.includes(raw as Filter) ? (raw as Filter) : "all";
}

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    filter?: string;
    q?: string;
    account?: string;
    error?: string;
    created?: string;
    emailed?: string;
    deleted?: string;
    removed?: string;
    delete?: string;
  }>;
}) {
  const params = await searchParams;
  const viewer = await resolveViewer();
  const [accounts, admins, rejections, drops, usage] = await Promise.all([
    listWorkspaceSummaries(),
    listAdmins(),
    // Fetched for every section rather than only Deliverability: it is three
    // aggregated rows, and a conditional read here would mean the console's
    // data shape changed with the tab, which is a bug waiting to be written.
    recentIngestionFailures(),
    // Same reasoning, and an even smaller read: the unique index bounds
    // feedback_drops to one row per (reason, event type).
    recentFeedbackDrops(),
    // One row per workspace, two integers each. Unconditional for the same
    // reason as the two above: the drawer needs it on Accounts and the table
    // needs it on Billing, and a conditional read would make the console's
    // data shape depend on the tab.
    listWorkspaceUsage(),
  ]);

  const section = parseSection(params.section);
  const filter = parseFilter(params.filter);
  const q = (params.q ?? "").trim();

  const requestedAccount = Number(params.account);
  const selected =
    accounts.find((w) => w.id === requestedAccount) ?? accounts[0] ?? null;

  const query: AdminQuery = {
    section,
    filter,
    q,
    account: Number.isInteger(requestedAccount) ? requestedAccount : null,
  };

  // Search matches on the things an operator actually knows: the business
  // name, the owner's login and the workspace's inbound address.
  const needle = q.toLowerCase();
  const visible = accounts.filter((w) => {
    const matchesQuery =
      !needle ||
      w.name.toLowerCase().includes(needle) ||
      (w.ownerEmail ?? "").toLowerCase().includes(needle) ||
      w.inboundEmail.toLowerCase().includes(needle);
    const matchesFilter =
      filter === "all" ||
      (filter === "attention" ? needsAttention(w) : accountStatus(w) === filter);
    return matchesQuery && matchesFilter;
  });

  // ?delete=<id> opens the type-the-name confirmation for that workspace.
  const deleteTarget =
    accounts.find((w) => String(w.id) === params.delete) ?? null;

  // Real: how many agent logins the selected workspace has.
  const teamSize = selected ? (await listAgentEmails(selected.id)).length : 0;

  // The access log: the whole thing for its own pane, and the selected
  // account's slice for the drawer. Both are only fetched where they're shown.
  const sessions = section === "access" ? await listImpersonationSessions() : [];
  // Same section, so the same condition. Two tables, one question.
  const adminActionRows = section === "access" ? await recentAdminActions() : [];
  /*
    The whole point of the hash chain. It is written on every impersonation and
    until now NOTHING ever checked it — a tamper-evident log nobody verifies is
    not tamper-evident, it is two extra columns. Same shape of gap as
    suppressAddress having no callers and /search having no way in.
  */
  const chain = section === "access" ? await verifyImpersonationLog() : null;
  const recentAccess =
    section === "accounts" && selected
      ? await listImpersonationSessionsForWorkspace(selected.id, 5)
      : [];

  // Two grouped counts, fetched only for the pane that shows them. Unlike the
  // reads above these are aggregates over the two biggest tables in the
  // product, so they are worth not doing on every tab.
  const [transactional, campaignTotals] =
    section === "deliverability"
      ? await Promise.all([
          transactionalDeliveryTotals(),
          campaignDeliveryTotals(),
        ])
      : [null, null];

  /*
   * The environment answers, gathered once.
   *
   * `stripeConfigured` and `stripePriceId` are imported rather than reading
   * STRIPE_SECRET_KEY here, so the console cannot drift from the module that
   * actually decides whether billing works. The other three are read directly
   * because their owners are route handlers, and importing a route into a page
   * to borrow a constant is a worse coupling than naming the variable twice.
   *
   * CAMPAIGN_DELIVERY_MODE is compared to exactly "ses", the same equality
   * lib/deliver.ts uses. Anything absent, empty or misspelled is log-only,
   * which is the safe direction: the failure mode of guessing is mailing
   * forty thousand real people.
   */
  const gates: ConsoleGates = {
    stripeConfigured: stripeConfigured(),
    allPricesConfigured: PLANS.every((p) => stripePriceId(p.id) !== null),
    transactionalSending: Boolean(process.env.RESEND_API_KEY),
    transactionalFeedback: Boolean(
      process.env.RESEND_DELIVERY_WEBHOOK_SIGNING_SECRET ??
        process.env.RESEND_WEBHOOK_SIGNING_SECRET,
    ),
    campaignDeliveryLive: process.env.CAMPAIGN_DELIVERY_MODE === "ses",
    campaignFeedback: Boolean(process.env.SES_SNS_TOPIC_ARN),
  };

  const pane = PANE[section];

  return (
    <div className="pba-page">
      <div className="pba-shell">
        <nav className="pba-side">
          <div className="pba-brand">
            <span className="pba-brand-tile">
              <EnvelopeIcon />
            </span>
            <span>
              <span className="pba-brand-name">Postbox</span>
              <span className="pba-brand-sub">Internal admin</span>
            </span>
          </div>

          <div className="pba-divider" />

          <div className="pba-nav">
            <NavRow query={query} to="overview" label="Overview" />
            <NavRow
              query={query}
              to="accounts"
              label="Accounts"
              count={accounts.length}
            />
            <NavRow query={query} to="access" label="Access log" />
            <NavRow query={query} to="billing" label="Billing" />
            <NavRow query={query} to="deliverability" label="Deliverability" />
            <NavRow query={query} to="support" label="Support" />
          </div>

          <div className="pba-side-foot">
            <div className="pba-whoami">
              <div className="pba-whoami-label">Signed in as</div>
              <div className="pba-whoami-email">{viewer.email}</div>
              <AuditedSignOutButton className="pba-signout">
                Sign out
              </AuditedSignOutButton>
            </div>
          </div>
        </nav>

        <div className="pba-main">
          <header className="pba-header">
            <div className="pba-htitles">
              <h1 className="pba-htitle">{pane.title}</h1>
              <p className="pba-hsub">{pane.subtitle}</p>
            </div>
            <div className="pba-hactions">
              <form method="get" action="/admin" className="pba-search">
                <SearchIcon />
                {section !== "accounts" && (
                  <input type="hidden" name="section" value={section} />
                )}
                {filter !== "all" && (
                  <input type="hidden" name="filter" value={filter} />
                )}
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search accounts…"
                  aria-label="Search accounts"
                />
              </form>
              <Link
                href={`${hrefFor(query, { section: "accounts" })}#new-account`}
                className="pba-btn pba-btn-primary"
              >
                New account
              </Link>
            </div>
          </header>

          <div className="pba-body">
            <main className="pba-content">
              <Banners params={params} />

              {section === "accounts" && (
                <AccountsSection
                  accounts={accounts}
                  visible={visible}
                  query={query}
                  deleteTarget={deleteTarget}
                />
              )}
              {section === "overview" && (
                <OverviewSection accounts={accounts} gates={gates} />
              )}
              {section === "access" && (
                <AccessSection
                  sessions={sessions}
                  actions={adminActionRows}
                  chain={chain}
                />
              )}
              {section === "billing" && (
                <BillingSection
                  accounts={accounts}
                  usage={usage}
                  gates={gates}
                />
              )}
              {section === "deliverability" && transactional && campaignTotals && (
                <DeliverabilitySection
                  accounts={accounts}
                  rejections={rejections}
                  drops={drops}
                  transactional={transactional}
                  campaignTotals={campaignTotals}
                  gates={gates}
                />
              )}
              {section === "support" && (
                <SupportSection admins={admins} viewerEmail={viewer.email} />
              )}
            </main>

            {section === "accounts" && (
              <AccountDrawer
                account={selected}
                teamSize={teamSize}
                query={query}
                recentAccess={recentAccess}
                usage={selected ? (usage.get(selected.id) ?? null) : null}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavRow({
  query,
  to,
  label,
  count,
}: {
  query: AdminQuery;
  to: Section;
  label: string;
  count?: number;
}) {
  const active = query.section === to;
  return (
    <Link
      href={hrefFor(query, { section: to, filter: "all" })}
      className={`pba-navrow${active ? " is-active" : ""}`}
    >
      <span className="pba-navlabel">{label}</span>
      {count !== undefined && <span className="pba-count">{count}</span>}
    </Link>
  );
}

/** Outcome banners from the Server Actions. */
function Banners({
  params,
}: {
  params: {
    error?: string;
    created?: string;
    emailed?: string;
    deleted?: string;
    removed?: string;
  };
}) {
  const { error, created, emailed, deleted, removed } = params;
  return (
    <>
      {error && <div className="pba-banner pba-banner-err">{error}</div>}
      {deleted && (
        <div className="pba-banner pba-banner-ok">
          <b>{deleted}</b> and all of its data has been permanently deleted.
        </div>
      )}
      {removed && (
        <div className="pba-banner pba-banner-ok">
          <b>{removed}</b> is no longer an admin.
        </div>
      )}
      {created && (
        <div className="pba-banner pba-banner-ok">
          {emailed === "1" ? (
            <>
              <b>{created}</b> is ready — we&rsquo;ve emailed the client an
              invitation to sign up.
            </>
          ) : (
            <>
              <b>{created}</b> is ready, but the invite email couldn&rsquo;t be
              sent. Ask the client to sign up at <b>postbox.help</b> using the
              email you entered.
            </>
          )}
        </div>
      )}
    </>
  );
}
