import CentredSkeleton from "@/components/skeletons/CentredSkeleton";

/**
 * Sign in.
 *
 * Stands in for the moment before Clerk's bundle arrives, when the page is
 * otherwise blank — not for the form itself, which brings its own loading
 * state. See components/skeletons/CentredSkeleton.tsx.
 */
export default function Loading() {
  return <CentredSkeleton label="Loading sign in" height={380} />;
}
