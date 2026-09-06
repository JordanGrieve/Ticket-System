import MarketingSkeleton from "@/components/skeletons/MarketingSkeleton";

/**
 * The contact page.
 *
 * force-dynamic, so it is rendered per request — see the note in
 * app/contact/page.tsx for why it must not be prerendered. The block stands in
 * for the form, or for the “not connected yet” notice when the key is unset.
 */
export default function Loading() {
  return <MarketingSkeleton label="Loading the contact form" lines={2} block={300} />;
}
