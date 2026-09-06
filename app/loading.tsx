import MarketingSkeleton from "@/components/skeletons/MarketingSkeleton";

/**
 * The marketing homepage.
 *
 * Dynamic — it calls auth() to decide whether the CTA offers a trial or an
 * enquiry — so this genuinely renders on a cold start, before any navigation
 * is involved. The block beneath the copy stands in for the product shot.
 */
export default function Loading() {
  return <MarketingSkeleton label="Loading Postbox" lines={3} block={280} />;
}
