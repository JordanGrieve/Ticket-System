import MarketingSkeleton from "@/components/skeletons/MarketingSkeleton";

/**
 * The pricing page.
 *
 * Prerendered, so this is the client-side navigation boundary rather than a
 * first-load one. The block stands in for the three plan cards.
 */
export default function Loading() {
  return <MarketingSkeleton label="Loading pricing" lines={2} block={320} />;
}
