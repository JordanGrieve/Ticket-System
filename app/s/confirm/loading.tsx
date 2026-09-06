import CardSkeleton from "@/components/skeletons/CardSkeleton";

/**
 * The confirm-your-subscription page, reached from the email link.
 *
 * Shape only — see components/skeletons/CardSkeleton.tsx for why these public
 * pages carry a skeleton at all when most of them render instantly on a first
 * load. The short version: this boundary is for client-side navigation, over
 * the visitor's connection rather than a developer's.
 */
export default function Loading() {
  return (
    <CardSkeleton
      prefix="s"
      lines={2}
      button
      label="Loading"
    />
  );
}
