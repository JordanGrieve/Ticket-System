import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { initials, relativeTime } from "@/lib/ticket-format";
import {
  SUBSCRIBERS_PAGE_SIZE,
  SUBSCRIBER_STATUSES,
  listSubscriberPage,
  parseStatus,
  statusCounts,
} from "./queries";
import { STATUS_LABEL } from "./labels";
import "../../subscribers.css";

export const metadata = { title: "Subscribers · Postbox" };

/**
 * /subscribers — who is actually on this workspace's marketing lists.
 *
 * Until now the only view of the audience was a recipient count on a campaign,
 * which is a number with no way to check it. This is the screen that answers
 * "who did we mail, and were we allowed to".
 *
 * ── TENANCY ──
 * `viewer.workspace.id` from resolveViewer() is the ONLY source of the
 * workspace filter. Nothing here reads an id from the URL: `?status=` is
 * validated against the union and `?page=` is clamped to a positive integer,
 * and neither of them can widen what is selected beyond this one workspace.
 *
 * ── NO UNBOUNDED SELECT ──
 * subscribers is the fastest-growing table in the product. This page reads at
 * most SUBSCRIBERS_PAGE_SIZE + 1 rows plus one grouped COUNT, whatever the size
 * of the list.
 *
 * ── COLOUR ──
 * Everything renders through the .psb-* classes in app/subscribers.css. There
 * are six themes and every one of them redefines the whole token set, so a
 * literal here is a card nobody can read in five of them.
 */
export default async function SubscribersPage({
  searchParams,
}: {
  // Promise-shaped since 15; see node_modules/next/dist/docs — file-conventions/page.
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const viewer = await resolveViewer();
  if (!viewer.workspace) redirect(viewer.isAdmin ? "/admin" : "/no-access");
  const workspace = viewer.workspace;

  const { status: statusParam, page: pageParam } = await searchParams;
  const status = parseStatus(statusParam);
  const page = Math.max(1, Math.floor(Number(pageParam)) || 1);

  const [counts, { rows, hasMore }] = await Promise.all([
    statusCounts(workspace.id),
    listSubscriberPage(workspace.id, status, page),
  ]);

  const now = new Date();
  const shown = status === null ? counts.all : counts[status];
  const filterHref = (s: string | null) =>
    s === null ? "/subscribers" : `/subscribers?status=${s}`;
  const pageHref = (p: number) =>
    `/subscribers?${status === null ? "" : `status=${status}&`}page=${p}`;

  return (
    // The dashboard shell is height-constrained with overflow hidden, so a
    // route that does not opt into this scroll container simply clips.
    <div className="pbm-page pb-scroll">
      <div className="psb-wrap">
        <div className="psb-col">
          <header className="psb-head">
            <h1 className="psb-title">Subscribers</h1>
            <p className="psb-sub">
              {counts.all === 0
                ? `No one has signed up to ${workspace.name} yet.`
                : `${counts.all.toLocaleString()} ${
                    counts.all === 1 ? "address" : "addresses"
                  } on ${workspace.name}, ${counts.subscribed.toLocaleString()} still subscribed.`}
            </p>
          </header>

          {counts.all > 0 && (
            <nav className="psb-filters" aria-label="Filter by status">
              <Link
                href={filterHref(null)}
                className="psb-filter"
                data-active={status === null}
                aria-current={status === null ? "page" : undefined}
              >
                All
                <span className="psb-filter-count">
                  {counts.all.toLocaleString()}
                </span>
              </Link>
              {SUBSCRIBER_STATUSES.map((s) => (
                <Link
                  key={s}
                  href={filterHref(s)}
                  className="psb-filter"
                  data-active={status === s}
                  aria-current={status === s ? "page" : undefined}
                >
                  {STATUS_LABEL[s]}
                  <span className="psb-filter-count">
                    {counts[s].toLocaleString()}
                  </span>
                </Link>
              ))}
            </nav>
          )}

          {rows.length === 0 ? (
            <div className="psb-empty">
              {counts.all === 0 ? (
                <>
                  <p className="psb-empty-title">No subscribers yet</p>
                  <p className="psb-empty-body">
                    Addresses arrive here when someone completes your signup
                    form — the hosted page and the embeddable form both write
                    straight into this list, together with the consent record
                    that proves they asked for it. Nobody is added here by
                    hand, and people who have only ever emailed support are not
                    subscribers.
                  </p>
                </>
              ) : (
                <>
                  <p className="psb-empty-title">
                    No {status ? STATUS_LABEL[status].toLowerCase() : ""}{" "}
                    subscribers
                  </p>
                  <p className="psb-empty-body">
                    {page > 1
                      ? "That page is past the end of the list."
                      : "Nobody is in this state right now."}{" "}
                    <Link href={filterHref(null)}>Show everyone</Link>.
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="psb-list">
              {rows.map((s) => {
                // Both halves, not either: a timestamp with no method, or a
                // method with no timestamp, is not a record you could show
                // anyone. The detail page says which half is missing.
                const consented =
                  s.consentMethod !== null && s.consentAt !== null;
                return (
                  <li key={s.id}>
                    <Link href={`/subscribers/${s.id}`} className="psb-row">
                      <span className="psb-avatar" aria-hidden>
                        {initials(s.name ?? s.email)}
                      </span>
                      <span className="psb-person">
                        <span className="psb-name">
                          {s.name ?? s.email}
                        </span>
                        <span className="psb-email">
                          {s.name === null ? "No name on record" : s.email}
                        </span>
                      </span>
                      <span className="psb-meta">
                        <span
                          className="psb-consent"
                          data-ok={consented}
                          title={
                            consented
                              ? "Consent evidence is on record"
                              : "No consent evidence on record"
                          }
                        >
                          {consented ? "Consent ✓" : "No consent"}
                        </span>
                        <span className="psb-chip" data-status={s.status}>
                          {STATUS_LABEL[s.status]}
                        </span>
                        <span className="psb-source">
                          {s.source ?? "source unknown"}
                        </span>
                        <span className="psb-when" title="Subscribed">
                          {relativeTime(s.subscribedAt, now)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {(page > 1 || hasMore) && (
            // .pbm-pager comes from mail.css, imported by the dashboard layout.
            <nav className="pbm-pager" aria-label="Subscriber pages">
              {page > 1 ? (
                <Link href={pageHref(page - 1)}>← Newer</Link>
              ) : (
                <span className="pbm-pager-off">← Newer</span>
              )}
              <span className="pbm-pager-pos">
                {shown === 0
                  ? `Page ${page}`
                  : `${((page - 1) * SUBSCRIBERS_PAGE_SIZE + 1).toLocaleString()}–${(
                      (page - 1) * SUBSCRIBERS_PAGE_SIZE + rows.length
                    ).toLocaleString()} of ${shown.toLocaleString()}`}
              </span>
              {hasMore ? (
                <Link href={pageHref(page + 1)}>Older →</Link>
              ) : (
                <span className="pbm-pager-off">Older →</span>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
