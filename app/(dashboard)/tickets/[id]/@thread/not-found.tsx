import Link from "next/link";

/**
 * `notFound()` from the @thread slot lands here.
 *
 * Before the split, a missing ticket 404'd the whole route because page.tsx
 * awaited getTicket() before returning any JSX. Now the list pane is a sibling
 * slot that has already started streaming, so a slot-scoped not-found is both
 * what Next gives us and the better outcome: the list stays usable and only
 * the conversation column reports the miss.
 *
 * One consequence to be aware of: because the response has already begun
 * streaming, the HTTP status stays 200 and Next marks the document `noindex`
 * instead. That is the documented trade-off for anything that 404s after a
 * Suspense boundary has rendered, and it costs nothing here — every
 * /tickets/[id] URL is behind Clerk auth and is never crawled.
 */
export default function ThreadNotFound() {
  return (
    <section className="pbm-thread pbm-thread--empty">
      <p className="pbm-placeholder-title">Conversation not found</p>
      <p className="pbm-placeholder-body">
        This ticket does not exist, or it belongs to another workspace.{" "}
        <Link href="/inbox">Back to the inbox</Link>
      </p>
    </section>
  );
}
