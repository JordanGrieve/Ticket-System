import CentredSkeleton from "@/components/skeletons/CentredSkeleton";

/**
 * Sign up.
 *
 * Same as sign-in: this covers the blank moment before Clerk loads, not the
 * form, which handles its own.
 */
export default function Loading() {
  return <CentredSkeleton label="Loading sign up" height={380} />;
}
