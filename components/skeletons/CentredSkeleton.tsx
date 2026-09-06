import "../../app/skeleton.css";

/**
 * The placeholder for a full-screen centred page: /sign-in, /sign-up,
 * /no-access.
 *
 * All three are a lockup above a block in the middle of an empty viewport, and
 * all three declare that layout with inline styles rather than classes — so
 * unlike the other skeletons here there is no real class to borrow, and the
 * geometry is repeated. It is repeated ONCE, here, rather than three times.
 *
 * ── THE SIGN-IN CASE IS THE INTERESTING ONE ──
 * Clerk renders its own loading state inside <SignIn>, so this does not try to
 * draw a form: it stands in for the moment BEFORE Clerk's bundle has arrived,
 * when the page is otherwise blank. Drawing a fake form underneath would mean
 * two different loading states in sequence — a fake form, then Clerk's own —
 * which reads worse than one honest block.
 */
export default function CentredSkeleton({
  label,
  height = 260,
}: {
  label: string;
  /** How tall the block is. Sign-in's form is taller than a message. */
  height?: number;
}) {
  return (
    <div
      className="pbk"
      aria-busy="true"
      aria-label={label}
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--app-bg)",
        padding: 24,
      }}
    >
      <div aria-hidden style={{ width: "100%", maxWidth: 400 }}>
        {/* The lockup: a mark and a wordmark, which is what sits above all
            three of these in the real pages. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 22,
          }}
        >
          <div
            className="pbk-fill"
            style={{ width: 26, height: 26, borderRadius: 8 }}
          />
          <div className="pbk-text" style={{ width: 92, height: 18 }}>
            &nbsp;
          </div>
        </div>
        <div
          className="pbk-fill"
          style={{ height, borderRadius: 18, width: "100%" }}
        />
      </div>
    </div>
  );
}
