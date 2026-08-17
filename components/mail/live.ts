/**
 * A one-number pipe from the star buttons to the nav's Starred count.
 *
 * The star used to call `router.refresh()` on every click. That is a full
 * server re-render of the whole route — nav, list pane and thread pane, every
 * query behind them — issued to move one integer by one. On a slow connection
 * the count visibly lagged the icon it was supposed to describe, and starring
 * three rows in a row queued three whole-page renders.
 *
 * Why an event and not React state: `StarButton` is rendered by the page (list
 * rows and the thread header) while the count lives in `MailNavShell`, which
 * the dashboard *layout* renders. They are siblings in different subtrees with
 * no common client ancestor, so there is nothing to lift the state into short
 * of a provider in the layout — a file this change has no business editing, for
 * a single number. A DOM event crosses that gap with no plumbing at all.
 *
 * The delta is a guess, and it is allowed to be: the list pane already refreshes
 * itself every 45s and an open thread every 30s, and every navigation re-reads
 * the counts from the database. Whenever the server speaks, MailNavShell throws
 * the accumulated delta away and believes it. So the worst case for a dropped
 * or duplicated event is a count that is briefly off by one and then corrects
 * itself — which is exactly what the old `router.refresh()` cost on every
 * single click, permanently.
 */

const STAR_EVENT = "postbox:star";

export type StarChange = {
  ticketId: number;
  /** The state the ticket has just moved TO. */
  starred: boolean;
};

/** Announce a star change that the server has already accepted. */
export function publishStar(change: StarChange): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StarChange>(STAR_EVENT, { detail: change }));
}

/**
 * Listen for star changes. Returns an unsubscribe function shaped for a direct
 * `return` out of useEffect.
 */
export function subscribeStar(onChange: (change: StarChange) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => onChange((e as CustomEvent<StarChange>).detail);
  window.addEventListener(STAR_EVENT, handler);
  return () => window.removeEventListener(STAR_EVENT, handler);
}
