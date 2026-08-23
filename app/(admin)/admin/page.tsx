import Link from "next/link";
import { recentIngestionFailures } from "@/lib/ingestion-log";
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
 * Where the design asked for numbers the product does not collect (billing,
 * subscribers, MRR, deliverability, an operator support queue), the pane says
 * so instead of showing a figure. See sections.tsx.
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
  const [accounts, admins, rejections] = await Promise.all([
    listWorkspaceSummaries(),
    listAdmins(),
    // Fetched for every section rather than only Deliverability: it is three
    // aggregated rows, and a conditional read here would mean the console's
    // data shape changed with the tab, which is a bug waiting to be written.
    recentIngestionFailures(),
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
  const recentAccess =
    section === "accounts" && selected
      ? await listImpersonationSessionsForWorkspace(selected.id, 5)
      : [];

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
              {section === "overview" && <OverviewSection accounts={accounts} />}
              {section === "access" && <AccessSection sessions={sessions} />}
              {section === "billing" && <BillingSection />}
              {section === "deliverability" && (
                <DeliverabilitySection
                  accounts={accounts}
                  rejections={rejections}
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
