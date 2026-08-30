import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Check your inbox",
  robots: { index: false, follow: false },
};

/**
 * Where a native form post lands after submitting.
 *
 * ── ONE PAGE FOR EVERY OUTCOME ──
 * Accepted, already subscribed, suppressed, and "the confirmation email failed
 * to send" all arrive here and read identically. That is the whole point: the
 * endpoint refuses to be a membership oracle (see its header), and a
 * distinguishable success page would hand back exactly the signal the endpoint
 * withholds.
 *
 * `?e=1` is the single exception, and it is a FLAG rather than a message. The
 * wording below is written here, in the page, so a crafted link cannot put
 * arbitrary text on a postbox.help URL. It covers both validation failures the
 * parser can produce, which are only ever about the address.
 */
export default async function CheckInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const failed = e === "1";

  if (failed) {
    return (
      <div className="s-card">
        <h1>That didn&rsquo;t look like an email address</h1>
        <p>
          Nothing has been sent. Head back to the form and check the address,
          then try again.
        </p>
      </div>
    );
  }

  return (
    <div className="s-card">
      <h1>
        <span className="s-ok">Almost there</span> — check your inbox
      </h1>
      <p>
        We&rsquo;ve sent you an email with a confirmation link.{" "}
        <strong>You won&rsquo;t receive anything until you press it.</strong>
      </p>
      <p>
        If it hasn&rsquo;t arrived in a few minutes, check your spam folder. You
        can close this tab.
      </p>
      <p className="s-fine" style={{ marginBottom: 0 }}>
        Didn&rsquo;t mean to sign up? Do nothing. Without that press, nothing is
        stored and you stay off the list.
      </p>
    </div>
  );
}
