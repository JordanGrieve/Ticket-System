import ProseSkeleton from "@/components/skeletons/ProseSkeleton";

/**
 * The terms of service.
 *
 * Prerendered, so this never shows on a first load — it is the boundary for
 * client-side navigation from the footer of another page, while the payload is
 * in flight. See components/skeletons/ProseSkeleton.tsx for why it draws a
 * suggestion of a document rather than a copy of one.
 */
export default function Loading() {
  return <ProseSkeleton label="Loading the terms" />;
}
