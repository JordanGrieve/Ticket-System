import CentredSkeleton from "@/components/skeletons/CentredSkeleton";

/**
 * Shown while working out whether this account has a workspace.
 *
 * Genuinely waits: the page awaits resolveViewer(), which is a Clerk lookup
 * and a database query, and it may then redirect. Somebody who has just
 * signed in and is about to be told they have no access should not watch a
 * blank screen while that is decided.
 */
export default function Loading() {
  return <CentredSkeleton label="Loading" height={200} />;
}
